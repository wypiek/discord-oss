import { Event } from "@spacebar/util";

export abstract class BaseEventWriter {
    abstract init(): Promise<void>;
    abstract close(): Promise<void>;
    abstract emit(event: Event): Promise<void>;
}
