export async function updatedImageHash(current: string | null | undefined, incoming: string | null | undefined, upload: (dataUri: string) => Promise<string | undefined>) {
    if (incoming === undefined) return current ?? null;
    if (!incoming) return null;
    if (incoming === current) return current;
    if (incoming.startsWith("data:")) return (await upload(incoming)) ?? current ?? null;
    return current ?? null;
}
