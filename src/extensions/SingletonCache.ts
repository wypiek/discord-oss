import { TimeSpan } from "./Timespan";
import { sleep } from "./Sleep";

export class SingletonCache<T> {
    private expiry: TimeSpan;
    private lastUpdated: Date = new Date(0);
    private isLocked: boolean = false;
    private cachedValue: T;

    constructor(expiry: TimeSpan) {
        this.expiry = expiry;
    }

    async getOrUpdate(factory: () => Promise<T>): Promise<T> {
        if (new TimeSpan(this.lastUpdated.getTime(), Date.now()).totalMillis < this.expiry.totalMillis) return this.cachedValue;

        if (this.isLocked) {
            // avoid running the factory twice (async)
            while (this.isLocked) await sleep(50);
            return this.cachedValue;
        }

        this.isLocked = true;
        try {
            const result = await factory();
            this.cachedValue = result;
            return result;
        } catch (e) {
            console.error(`[SingletonCache] Factory method failed, returning stale value:`, e);
            return this.cachedValue;
        } finally {
            this.isLocked = false;
        }
    }
}
