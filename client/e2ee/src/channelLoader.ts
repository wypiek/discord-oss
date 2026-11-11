interface ChannelLoaderOptions<T> {
    current: () => string | null;
    load: (channelId: string) => Promise<T>;
    receive: (channelId: string, value: T) => void;
    retry: () => void;
    retryMs?: number;
}

export function createChannelLoader<T>({ current, load, receive, retry, retryMs = 5000 }: ChannelLoaderOptions<T>) {
    const pending = new Map<string, Promise<void>>();
    let failed: { channelId: string; after: number } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (channelId: string) => {
        if (pending.has(channelId) || (failed?.channelId === channelId && Date.now() < failed.after)) return;
        const task = Promise.resolve()
            .then(() => load(channelId))
            .then((value) => {
                if (current() !== channelId) return;
                failed = null;
                receive(channelId, value);
            })
            .catch(() => {
                if (current() !== channelId) return;
                failed = { channelId, after: Date.now() + retryMs };
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => {
                    timer = null;
                    if (current() === channelId) retry();
                }, retryMs);
            })
            .finally(() => pending.delete(channelId));
        pending.set(channelId, task);
    };
}
