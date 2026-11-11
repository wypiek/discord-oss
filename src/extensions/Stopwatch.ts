// Inspired by the dotnet Stopwatch class
// Provides a simple interface to get elapsed time in high resolution
import { ElapsedTime } from "./ElapsedTime";

export class Stopwatch {
    private startTime: bigint;
    private endTime: bigint | null = null;

    static startNew(): Stopwatch {
        const stopwatch = new Stopwatch();
        stopwatch.start();
        return stopwatch;
    }

    start(): void {
        this.startTime = process.hrtime.bigint();
        this.endTime = null;
    }

    reset(): void {
        this.startTime = process.hrtime.bigint();
        this.endTime = null;
    }

    stop(): void {
        this.endTime = process.hrtime.bigint();
    }

    elapsed(): ElapsedTime {
        return new ElapsedTime((this.endTime ?? process.hrtime.bigint()) - this.startTime);
    }

    getElapsedAndReset(): ElapsedTime {
        const elapsed = this.elapsed();
        this.reset();
        return elapsed;
    }
}

export async function timePromise<T>(fn: () => Promise<T>): Promise<{ result: T; elapsed: ElapsedTime }> {
    const stopwatch = Stopwatch.startNew();
    const result = await fn();
    const elapsed = stopwatch.elapsed();
    return { result, elapsed };
}

export function timeFunction<T>(fn: () => T): { result: T; elapsed: ElapsedTime } {
    const stopwatch = Stopwatch.startNew();
    const result = fn();
    const elapsed = stopwatch.elapsed();
    return { result, elapsed };
}
