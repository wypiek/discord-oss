interface BrandAssetEntry<T> {
    pending: Promise<T | null>;
    settled: boolean;
}

export class BrandAssetCache<T> {
    private readonly entries = new Map<string, BrandAssetEntry<T>>();
    private active = 0;

    constructor(
        private readonly capacity = 16,
        private readonly concurrency = 4,
    ) {}

    get(key: string, load: () => Promise<T | null>): Promise<T | null> {
        const cached = this.entries.get(key);
        if (cached) {
            this.entries.delete(key);
            this.entries.set(key, cached);
            return cached.pending;
        }
        if (this.active >= this.concurrency) return Promise.resolve(null);
        if (this.entries.size >= this.capacity) {
            const oldest = [...this.entries].find(([, entry]) => entry.settled);
            if (!oldest) return Promise.resolve(null);
            this.entries.delete(oldest[0]);
        }
        this.active++;
        const entry: BrandAssetEntry<T> = {
            settled: false,
            pending: Promise.resolve()
                .then(load)
                .catch(() => null)
                .then((asset) => {
                    this.active--;
                    entry.settled = true;
                    if (asset === null && this.entries.get(key) === entry) this.entries.delete(key);
                    return asset;
                }),
        };
        this.entries.set(key, entry);
        return entry.pending;
    }
}
