import { app } from "electron";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HIDDEN_FLAG = "--hidden";

const linuxAutostartFile = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "autostart", "discord-oss.desktop");

const linuxExecutable = () => process.env.APPIMAGE || process.execPath;

export function setOpenAtLogin(enabled: boolean) {
    if (process.platform === "linux") {
        const file = linuxAutostartFile();
        if (!enabled) return rmSync(file, { force: true });
        mkdirSync(join(file, ".."), { recursive: true });
        writeFileSync(
            file,
            [
                "[Desktop Entry]",
                "Type=Application",
                "Name=Discord OSS",
                `Exec="${linuxExecutable()}" ${HIDDEN_FLAG}`,
                "Icon=discord-oss",
                "X-GNOME-Autostart-enabled=true",
                "",
            ].join("\n"),
        );
        return;
    }
    app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_FLAG] });
}

export const startedHidden = () => process.argv.includes(HIDDEN_FLAG) || (process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin);
