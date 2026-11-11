import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Channel, GoLiveStreams, Member, Recipient, Stream, StreamPreviews } from "@spacebar/database";
import { getPermission } from "@spacebar/util";
import { HTTPError } from "lambert-server";

const router: Router = Router({ mergeParams: true });
const MAX_PREVIEW_LENGTH = 2 * 1024 * 1024;

const PREVIEW_WAIT_MS = 10_000;
const waiters = new Map<string, Set<(url: string) => void>>();

const ownerOf = (key: string) => key.split(":").at(-1);

const canWatch = async (key: string, user_id: string) => {
    const parts = key.split(":");
    const [type] = parts;
    if (!((type === "guild" && parts.length === 4) || (type === "call" && parts.length === 3))) return false;
    if (ownerOf(key) === user_id) return true;
    const channel = await Channel.findOne({ where: { id: parts.at(-2) }, select: { id: true, guild_id: true } });
    if (!channel) return false;
    if (type === "call") return !channel.guild_id && (await Recipient.exists({ where: { channel_id: channel.id, user_id } }));
    if (!channel.guild_id || channel.guild_id !== parts[1]) return false;
    if (!(await Member.exists({ where: { id: user_id, guild_id: channel.guild_id } }))) return false;
    const permission = await getPermission(user_id, channel.guild_id, channel.id);
    return permission.has("VIEW_CHANNEL") && permission.has("CONNECT");
};

router.get("/", route({ responses: { 200: {}, 404: {} } }), async (req: Request, res: Response) => {
    const key = req.params.stream_key as string;
    const parts = key.split(":");
    if (!(await canWatch(key, req.user_id))) throw new HTTPError("Unknown stream preview", 404);
    if (!StreamPreviews.has(key) && !(await Stream.exists({ where: { owner_id: ownerOf(key), channel_id: parts.at(-2) } }))) throw new HTTPError("Unknown stream preview", 404);
    const ready = StreamPreviews.get(key);
    if (ready) return res.json({ url: ready });

    const url = await new Promise<string | undefined>((resolve) => {
        const listeners = waiters.get(key) ?? new Set();
        waiters.set(key, listeners);
        const done = (value?: string) => {
            clearTimeout(timer);
            listeners.delete(done);
            if (!listeners.size && waiters.get(key) === listeners) waiters.delete(key);
            res.off("close", abort);
            resolve(value);
        };
        const abort = () => done();
        const timer = setTimeout(done, PREVIEW_WAIT_MS);
        listeners.add(done);
        res.on("close", abort);
    });
    if (res.destroyed || res.writableEnded) return;
    if (!url) throw new HTTPError("Unknown stream preview", 404);
    res.json({ url });
});

router.post("/", route({ responses: { 204: {}, 400: {}, 403: {} } }), async (req: Request, res: Response) => {
    const key = req.params.stream_key as string;
    if (ownerOf(key) !== req.user_id) throw new HTTPError("Only the stream owner can upload a preview", 403);
    const thumbnail = req.body?.thumbnail;
    if (typeof thumbnail !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(thumbnail) || thumbnail.length > MAX_PREVIEW_LENGTH)
        throw new HTTPError("Invalid thumbnail", 400);
    const streams = await Stream.find({ where: { owner_id: req.user_id }, relations: { channel: true } });
    if (!streams.some((stream) => GoLiveStreams.key(stream) === key)) throw new HTTPError("Unknown stream", 404);
    StreamPreviews.set(key, thumbnail);
    for (const notify of [...(waiters.get(key) ?? [])]) notify(thumbnail);
    res.sendStatus(204);
});

export default router;
