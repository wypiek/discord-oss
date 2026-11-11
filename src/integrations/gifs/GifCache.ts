export class GifCache<T> {
    private expires = 0;
    private value: T;
    private pending?: Promise<T>;
    constructor(private duration: number) {}
    getOrUpdate(factory: () => Promise<T>): Promise<T> {
        if (this.expires > Date.now()) return Promise.resolve(this.value);
        if (this.pending) return this.pending;
        this.pending = factory()
            .then((value) => {
                this.value = value;
                this.expires = Date.now() + this.duration;
                return value;
            })
            .finally(() => {
                this.pending = undefined;
            });
        return this.pending;
    }
}
