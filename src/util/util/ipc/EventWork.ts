import { AsyncLocalStorage } from "node:async_hooks";
import { ProcessLifecycle } from "../ProcessLifecycle";

export class EventWork {
    private static readonly context = new AsyncLocalStorage<{ active: boolean }>();
    private static readonly scopes = new Set<EventWork>();
    private static registered = false;
    private static draining = false;
    private readonly pending = new Set<Promise<void>>();
    private closed = false;

    run(callback: () => unknown): void {
        if ((this.closed || EventWork.draining || ProcessLifecycle.state === "draining" || ProcessLifecycle.state === "stopped") && !EventWork.context.getStore()?.active) return;
        if (!EventWork.registered) {
            EventWork.registered = true;
            ProcessLifecycle.eventEmitter.on("draining", () => EventWork.drain());
        }
        const context = { active: true };
        try {
            const result = EventWork.context.run(context, callback);
            if (!result || typeof (result as PromiseLike<unknown>).then !== "function") {
                context.active = false;
                return;
            }
            EventWork.scopes.add(this);
            const work = Promise.resolve(result)
                .then(
                    () => {},
                    () => console.error("[Event] Async callback failed"),
                )
                .finally(() => {
                    context.active = false;
                    this.pending.delete(work);
                    if (!this.pending.size) EventWork.scopes.delete(this);
                });
            this.pending.add(work);
        } catch {
            context.active = false;
            console.error("[Event] Callback failed");
        }
    }

    async close(): Promise<void> {
        this.closed = true;
        await this.wait();
    }

    private async wait(): Promise<void> {
        while (this.pending.size) await Promise.all(this.pending);
    }

    private static async drain(): Promise<void> {
        this.draining = true;
        while (this.scopes.size) await Promise.all(Array.from(this.scopes, (scope) => scope.wait()));
    }
}
