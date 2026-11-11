import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { RegexPatternMatch, matchRegexPatterns } from "./automodRegexMatch";

export const REGEX_TIMEOUT_MS = 250;
export const MAX_REGEX_WORKERS = 4;
const WORKER_START_TIMEOUT_MS = 10_000;

type Job = { content: string; patterns: string[]; resolve: (matches: RegexPatternMatch[] | null) => void };

const idle: Worker[] = [];
const online = new WeakSet<Worker>();
const queue: Job[] = [];
let alive = 0;
let workersUnavailable = false;
const workerPath = join(__dirname, "automodRegexWorker.js");

function dispatch(job: Job, worker: Worker) {
    worker.ref();
    const done = (matches: RegexPatternMatch[] | null, healthy: boolean) => {
        clearTimeout(timer);
        worker.off("message", onMessage);
        worker.off("error", onError);
        job.resolve(matches);
        if (healthy) {
            worker.unref();
            idle.push(worker);
        } else {
            alive--;
            worker.terminate().catch(() => undefined);
        }
        drain();
    };
    const onMessage = (matches: RegexPatternMatch[]) => done(matches, true);
    const onError = () => done(null, false);
    const expire = () => {
        console.warn(`[AutoMod] a regex rule ran longer than ${REGEX_TIMEOUT_MS} ms and was skipped`);
        done(null, false);
    };
    let timer = setTimeout(expire, online.has(worker) ? REGEX_TIMEOUT_MS : WORKER_START_TIMEOUT_MS);
    if (!online.has(worker))
        worker.once("online", () => {
            clearTimeout(timer);
            timer = setTimeout(expire, REGEX_TIMEOUT_MS);
        });
    worker.on("message", onMessage);
    worker.once("error", onError);
    worker.postMessage({ content: job.content, patterns: job.patterns });
}

function drain() {
    while (queue.length) {
        const worker = idle.pop() ?? spawn();
        if (!worker) return;
        dispatch(queue.shift()!, worker);
    }
}

function spawn() {
    if (alive >= MAX_REGEX_WORKERS || workersUnavailable) return undefined;
    try {
        const worker = new Worker(workerPath);
        worker.unref();
        alive++;
        worker.once("online", () => online.add(worker));
        worker.once("exit", () => {
            const index = idle.indexOf(worker);
            if (index === -1) return;
            idle.splice(index, 1);
            alive--;
        });
        return worker;
    } catch {
        workersUnavailable = true;
        return undefined;
    }
}

export function matchRegexPatternsWithTimeout(content: string, patterns: string[]) {
    if (!patterns.length || !content) return Promise.resolve([] as RegexPatternMatch[]);
    return new Promise<RegexPatternMatch[] | null>((resolve) => {
        queue.push({ content, patterns, resolve });
        drain();
        if (workersUnavailable && queue.length) {
            for (const job of queue.splice(0)) job.resolve(matchRegexPatterns(job.content, job.patterns));
        }
    });
}
