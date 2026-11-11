const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const shellDirectories = {
    "darwin-arm64": ["chrome-headless-shell-mac-arm64", "chrome-headless-shell"],
    "darwin-x64": ["chrome-headless-shell-mac-x64", "chrome-headless-shell"],
    "linux-x64": ["chrome-headless-shell-linux64", "chrome-headless-shell"],
    "linux-arm64": ["chrome-headless-shell-linux-arm64", "chrome-headless-shell"],
    "win32-x64": ["chrome-headless-shell-win64", "chrome-headless-shell.exe"],
};

function chromiumPath() {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    const shell = shellDirectories[`${process.platform}-${process.arch}`];
    if (!shell) return undefined;
    const cache =
        process.env.PLAYWRIGHT_BROWSERS_PATH ||
        path.join(
            os.homedir(),
            process.platform === "darwin" ? "Library/Caches/ms-playwright" : process.platform === "win32" ? "AppData/Local/ms-playwright" : ".cache/ms-playwright",
        );
    let builds;
    try {
        builds = fs.readdirSync(cache).filter((name) => /^chromium_headless_shell-\d+$/.test(name));
    } catch {
        return undefined;
    }
    builds.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const build of builds) {
        const candidate = path.join(cache, build, ...shell);
        if (fs.existsSync(candidate)) return candidate;
    }
    return undefined;
}

module.exports = { chromiumPath };
