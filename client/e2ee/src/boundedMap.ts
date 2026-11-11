export class BoundedMap<K, V> extends Map<K, V> {
    readonly limit: number;

    constructor(limit: number) {
        super();
        this.limit = limit;
    }

    override get(key: K) {
        if (!super.has(key)) return undefined;
        const value = super.get(key) as V;
        super.delete(key);
        super.set(key, value);
        return value;
    }

    override set(key: K, value: V) {
        super.delete(key);
        super.set(key, value);
        while (this.size > this.limit) super.delete(this.keys().next().value as K);
        return this;
    }
}
