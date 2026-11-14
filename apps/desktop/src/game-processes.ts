import { type ChildProcess, execFile, spawn } from "node:child_process";
import { readdir, readFile, readlink } from "node:fs/promises";
import { linuxProcess, parsePsArguments, parsePsList, parseWindowsProcesses } from "./game-match";
import type { RunningProcess } from "./game-types";

export const SCAN_MS = 15_000;

export interface ProcessWatcher {
    start(argumentNames: Set<string>, onProcesses: (processes: RunningProcess[]) => void): void;
    scanNow(): void;
    stop(): void;
}

const run = (file: string, args: string[], timeout = 5000) =>
    new Promise<string | null>((resolve) => {
        execFile(file, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => resolve(error ? null : stdout));
    });

abstract class IntervalWatcher implements ProcessWatcher {
    private timer: NodeJS.Timeout | null = null;
    private scanning = false;
    protected argumentNames = new Set<string>();
    private onProcesses: (processes: RunningProcess[]) => void = () => {};

    protected abstract list(): Promise<RunningProcess[] | null>;

    start(argumentNames: Set<string>, onProcesses: (processes: RunningProcess[]) => void) {
        this.argumentNames = argumentNames;
        this.onProcesses = onProcesses;
        if (this.timer) return;
        this.timer = setInterval(() => this.scanNow(), SCAN_MS);
        this.scanNow();
    }

    scanNow() {
        if (this.scanning || !this.timer) return;
        this.scanning = true;
        this.list()
            .then((processes) => {
                if (processes && this.timer) this.onProcesses(processes);
            })
            .catch(() => {})
            .finally(() => {
                this.scanning = false;
            });
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }
}

class MacWatcher extends IntervalWatcher {
    protected async list() {
        const output = await run("ps", ["-x", "-ww", "-o", "pid=,comm="]);
        if (output === null) return null;
        const processes = parsePsList(output);
        const needArgs = processes.filter((process) => this.argumentNames.has((process.path.split("/").pop() ?? "").toLowerCase()));
        if (needArgs.length) {
            const args = parsePsArguments((await run("ps", ["-ww", "-o", "pid=,args=", "-p", needArgs.map((process) => process.pid).join(",")])) ?? "");
            for (const process of needArgs) process.cmdLine = args.get(process.pid);
        }
        return processes;
    }
}

class LinuxWatcher extends IntervalWatcher {
    protected async list() {
        const entries = await readdir("/proc").catch(() => null);
        if (!entries) return null;
        const processes = await Promise.all(
            entries
                .filter((entry) => /^\d+$/.test(entry) && Number(entry) !== process.pid)
                .map(async (entry) => {
                    const exe = await readlink(`/proc/${entry}/exe`).catch(() => null);
                    if (!exe) return null;
                    const cmdline = await readFile(`/proc/${entry}/cmdline`, "utf8").catch(() => "");
                    return linuxProcess(Number(entry), exe, cmdline);
                }),
        );
        return processes.filter((process): process is RunningProcess => !!process);
    }
}

const WINDOWS_SCRIPT = `$ErrorActionPreference = "SilentlyContinue"
$argNames = @(ARGUMENT_NAMES)
while ($true) {
    if (-not (Get-Process -Id PARENT_PID -ErrorAction SilentlyContinue)) { exit }
    $windowed = @{}
    foreach ($p in [System.Diagnostics.Process]::GetProcesses()) { if ($p.MainWindowHandle -ne [IntPtr]::Zero) { $windowed[$p.Id] = 1 } }
    $items = foreach ($p in Get-CimInstance -ClassName Win32_Process -Property ProcessId,Name,ExecutablePath,CommandLine) {
        if (-not $p.ExecutablePath) { continue }
        $item = @{ i = [int]$p.ProcessId; p = [string]$p.ExecutablePath; w = [int]$windowed.ContainsKey([int]$p.ProcessId) }
        if ($argNames -contains ([string]$p.Name).ToLowerInvariant()) { $item.c = [string]$p.CommandLine }
        $item
    }
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -Depth 2 -InputObject @($items)))
    [Console]::Out.Flush()
    Start-Sleep -Seconds SCAN_SECONDS
}`;

// The names come from the instance's game list, so they are untrusted. PowerShell
// closes a single-quoted string on ' and on the typographic quotes U+2018-201B
// alike, so only characters known to be inert inside one are let through.
const SAFE_PROCESS_NAME = /^[\p{L}\p{N} ._+\-()[\]&!@#%,=~]{1,128}$/u;

export const windowsScript = (argumentNames: Set<string>, parentPid: number) =>
    WINDOWS_SCRIPT.replace("ARGUMENT_NAMES", () =>
        [...argumentNames]
            .filter((name) => SAFE_PROCESS_NAME.test(name))
            .map((name) => `'${name}'`)
            .join(","),
    )
        .replace("PARENT_PID", String(parentPid))
        .replace("SCAN_SECONDS", String(SCAN_MS / 1000));

class WindowsWatcher implements ProcessWatcher {
    private child: ChildProcess | null = null;
    private stopped = true;
    private names = "";

    start(argumentNames: Set<string>, onProcesses: (processes: RunningProcess[]) => void) {
        const names = [...argumentNames].sort().join("\n");
        if (this.child && names === this.names) return;
        this.child?.kill();
        this.names = names;
        this.stopped = false;
        const child = spawn(
            "powershell.exe",
            [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-EncodedCommand",
                Buffer.from(windowsScript(argumentNames, process.pid), "utf16le").toString("base64"),
            ],
            { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
        );
        this.child = child;
        let buffer = "";
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
            buffer += chunk;
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            const last = lines.filter(Boolean).at(-1);
            const processes = last ? parseWindowsProcesses(last) : null;
            if (processes) onProcesses(processes);
        });
        child.on("exit", () => {
            if (this.child !== child) return;
            this.child = null;
            if (!this.stopped) setTimeout(() => !this.stopped && !this.child && this.start(argumentNames, onProcesses), 30_000).unref();
        });
    }

    scanNow() {}

    stop() {
        this.stopped = true;
        this.child?.kill();
        this.child = null;
    }
}

export function createProcessWatcher(): ProcessWatcher | null {
    if (process.platform === "darwin") return new MacWatcher();
    if (process.platform === "linux") return new LinuxWatcher();
    if (process.platform === "win32") return new WindowsWatcher();
    return null;
}
