import FormData from "form-data";
import { HTTPError } from "lambert-server/HTTPError";
import { InternalCdnAttachment } from "@spacebar/util/dtos/MessageOptions";
import { declaredAttachmentFilename } from "./AttachmentFilename";
import { storageOwnership } from "../../cdn/util/storageOwnership";
import { Config } from "./Config";

export async function uploadFile(
    path: string,
    // These are the only props we use, don't need to enforce the full type.
    file?: Pick<Express.Multer.File, "mimetype" | "originalname" | "buffer">,
    principal?: string,
    deadline?: AbortSignal,
): Promise<InternalCdnAttachment> {
    if (principal) return storageOwnership.run(principal, () => uploadFile(path, file, undefined, deadline));
    if (!file?.buffer) throw new HTTPError("Missing file in body");

    const form = new FormData();
    form.append("file", file.buffer, {
        contentType: file.mimetype,
        filename: file.originalname,
    });

    const response = await fetch(`${Config.get().cdn.endpointPrivate?.replace(/\/+$/, "")}${path}`, {
        headers: {
            signature: Config.get().security.requestSignature,
            ...(storageOwnership.getStore() ? { "x-storage-principal": storageOwnership.getStore()! } : {}),
            ...form.getHeaders(),
        },
        signal: deadline ? AbortSignal.any([AbortSignal.timeout(30000), deadline]) : AbortSignal.timeout(30000),
        redirect: "error",
        method: "POST",
        body: form.getBuffer(),
    });
    const result = (await readCdnResponse(response)) as InternalCdnAttachment;

    if (response.status !== 200) throw result;
    return result;
}

type DeclaredAttachment = {
    id?: string | number;
    filename?: string;
    title?: string;
    description?: string;
    duration_secs?: number;
    waveform?: string;
    is_spoiler?: boolean;
};

export const uploadDeadline = () => AbortSignal.timeout(Math.max(1, Config.get().cdn.uploadDeadlineSeconds) * 1000);

export async function uploadMessageFiles<T extends object>(
    path: string,
    files: Pick<Express.Multer.File, "fieldname" | "mimetype" | "originalname" | "buffer">[],
    declared: T[] = [],
    principal?: string,
) {
    const isStub = (attachment: object) => !("url" in attachment) && !("uploaded_filename" in attachment);
    const stubs = declared.filter(isStub) as DeclaredAttachment[];
    const uploaded: (InternalCdnAttachment & Omit<DeclaredAttachment, "id" | "is_spoiler"> & { flags?: number })[] = [];
    const deadline = uploadDeadline();
    for (const [index, file] of files.entries()) {
        const slot = /(\d+)\]?$/.exec(file.fieldname)?.[1] ?? String(index);
        const meta = stubs.find((stub) => String(stub.id) === slot);
        const result = await uploadFile(path, file, principal, deadline);
        if (!meta) {
            uploaded.push(result);
            continue;
        }
        const filename = declaredAttachmentFilename(meta.filename) ?? result.filename;
        uploaded.push({
            ...result,
            filename,
            title: meta.title,
            description: meta.description,
            duration_secs: meta.duration_secs,
            waveform: meta.waveform,
            flags: meta.is_spoiler || filename.startsWith("SPOILER_") ? 1 << 3 : undefined,
        });
    }
    return [...declared.filter((attachment) => !isStub(attachment)), ...uploaded];
}

export async function handleFile(path: string, body?: string, principal?: string): Promise<string | undefined> {
    if (!body || !body.startsWith("data:")) return undefined;
    try {
        const mimetype = body.split(":")[1].split(";")[0];
        const buffer = Buffer.from(body.split(",")[1], "base64");

        const { id } = await uploadFile(
            path,
            {
                buffer,
                mimetype,
                originalname: "banner",
            },
            principal,
        );
        return id;
    } catch (error) {
        console.error(error);
        throw new HTTPError(`Internal CDN error: Invalid response from POST $CDN${path}: ${(error as Error).message}`);
    }
}

export async function deleteFile(path: string) {
    const response = await fetch(`${Config.get().cdn.endpointPrivate?.replace(/\/+$/, "")}${path}`, {
        headers: {
            signature: Config.get().security.requestSignature,
            ...(storageOwnership.getStore() ? { "x-storage-principal": storageOwnership.getStore()! } : {}),
        },
        signal: AbortSignal.timeout(30000),
        redirect: "error",
        method: "DELETE",
    });
    const result = await readCdnResponse(response);

    if (response.status !== 200) throw result;
    return result;
}

async function readCdnResponse(response: Response): Promise<unknown> {
    if (!response.body) throw new HTTPError("Empty CDN response", 502);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > 512 * 1024) throw new HTTPError("CDN response too large", 502);
            chunks.push(chunk.value);
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}
