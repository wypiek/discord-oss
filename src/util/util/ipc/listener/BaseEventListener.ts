import { EventOpts } from "@spacebar/util";

export abstract class BaseEventListener {
    abstract init(): Promise<void>;
    abstract close(): Promise<void>;
    abstract listen(event: string, callback: (event: EventOpts) => unknown): Promise<() => Promise<void>>;
}
