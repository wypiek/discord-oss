import { parentPort } from "node:worker_threads";
import { matchRegexPatterns } from "./automodRegexMatch";

parentPort?.on("message", ({ content, patterns }: { content: string; patterns: string[] }) => {
    parentPort?.postMessage(matchRegexPatterns(content, patterns));
});
