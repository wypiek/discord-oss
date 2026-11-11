import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { red } from "picocolors";

export function getRevInfoOrFail(): { rev: string | null; lastModified: number } {
    const rootDir = path.join(__dirname, "../../../");
    // sanity check
    if (!fs.existsSync(path.join(rootDir, "package.json"))) {
        console.log(red("Error: Cannot find package.json in root directory. Are you running from the correct location?"));
    }

    // use .rev file if it exists
    if (fs.existsSync(path.join(rootDir, ".rev"))) {
        return JSON.parse(fs.readFileSync(path.join(rootDir, ".rev"), "utf-8"));
    }

    // fall back to invoking git
    try {
        const rev = execSync(`git -C "${rootDir}" rev-parse HEAD`).toString().trim();
        const lastModified = Number(execSync(`git -C "${rootDir}" log -1 --format=%cd --date=unix`).toString().trim());
        return {
            rev,
            lastModified,
        };
    } catch (e) {
        return { rev: null, lastModified: 0 };
    }
}
