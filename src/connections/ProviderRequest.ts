import { ApiError } from "@spacebar/util";

const TIMEOUT = 10_000;

export async function providerFetch(provider: string, url: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT) }).catch(() => {
        throw new ApiError(`${provider} didn't answer. Try again in a moment.`, 0, 502);
    });
    if (!res.ok) {
        console.warn(`[Connections] ${new URL(url).host} answered ${res.status} for ${provider}`);
        throw new ApiError(`${provider} refused the request. Try again in a moment.`, 0, 502);
    }
    return res;
}

export async function providerJson<T>(provider: string, url: string, init: RequestInit = {}): Promise<T> {
    const res = await providerFetch(provider, url, { ...init, headers: { Accept: "application/json", ...init.headers } });
    return (await res.json().catch(() => {
        throw new ApiError(`${provider} sent a response we couldn't read.`, 0, 502);
    })) as T;
}

export function providerFailure(provider: string, message: string) {
    return new ApiError(`${provider}: ${message}`, 0, 400);
}
