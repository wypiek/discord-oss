import os from "node:os";
import { readFileSync } from "node:fs";
import { red } from "picocolors";

export function initStats() {
    console.log(`[Path] Running in ${process.cwd()}`);
    console.log(`[Path] Running from ${__dirname}`);
    try {
        console.log(`[CPU] ${os.cpus()[0].model} (x${os.cpus().length})`);
    } catch {
        console.log("[CPU] Failed to get CPU model!");
    }

    console.log(`[System] ${os.platform()} ${os.release()} ${os.arch()}`);
    if (os.platform() == "linux") {
        try {
            const osReleaseLines = readFileSync("/etc/os-release", "utf8").split("\n");
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            //@ts-ignore
            const osRelease: { [key: string]: string } = {};
            for (const line of osReleaseLines) {
                if (!line) continue;
                const [key, value] = line.match(/(.*?)="?([^"]*)"?/)!.slice(1);
                osRelease[key] = value;
            }
            console.log(`[System]\x1b[${osRelease.ANSI_COLOR}m ${osRelease.NAME ?? "Unknown"} ${osRelease.VERSION ?? "Unknown"} (${osRelease.BUILD_ID ?? "No build ID"})\x1b[0m`);
        } catch (e) {
            console.log("[System] Unknown Linux distribution (missing /etc/os-release)");
            console.log(e);
        }
    }
    console.log(`[Process] Running with PID: ${process.pid}`);
    if (process.getuid && process.getuid() === 0) {
        console.warn(
            red(
                `[Process] Warning Spacebar is running as root, this highly discouraged and might expose your system vulnerable to attackers.` +
                    `Please run Spacebar as a user without root privileges.`,
            ),
        );
    }
}
