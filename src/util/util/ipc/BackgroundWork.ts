type BackgroundTracker = (work: Promise<unknown>) => void;

let tracker: BackgroundTracker | undefined;

export function useBackgroundTracker(next: BackgroundTracker) {
    tracker = next;
}

export function trackBackground<T>(work: Promise<T>) {
    tracker?.(work);
    return work;
}
