const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export const refuseRedirectsInFetch = () => {
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.redirect !== "error") return nativeFetch(input, init);
        const response = await nativeFetch(input, { ...init, redirect: "manual" });
        if (!redirectStatuses.has(response.status)) return response;
        await response.body?.cancel();
        throw new TypeError(`fetch refused a ${response.status} redirect because the request set redirect to error`);
    }) as typeof fetch;
};
