import path from "node:path";
import express, { NextFunction, Request, Response, Router } from "express";
import { In } from "typeorm";
import { ActivityInstance, ActivityInstanceParticipant, ActivityInstances, Channel, getDatabase, Member, User } from "@spacebar/database";
import { isSqlite, sqlNow } from "@spacebar/database/Sql";
import { ChannelType } from "@spacebar/schemas";
import { Config } from "@spacebar/util";
import { ProcessLifecycle } from "@spacebar/util/util/ProcessLifecycle";
import { ACTIVITY_ASSETS, BuiltinActivity, readProxyTicket } from "./common";

const BOARD_WIDTH = 1600;
const BOARD_HEIGHT = 900;
const MAX_BOARD_POINTS = 200_000;
const MAX_STROKE_POINTS = 4_000;
const MAX_BATCH_POINTS = 512;
const ACCESS_TTL = 5_000;
const MAX_ACCESS_ENTRIES = 10_000;
const MAX_KNOWN_CHANNELS = 10_000;
const SAVE_DELAY = 5_000;
export const MAX_BOARD_STROKES = 10_000;
export const MAX_VIEWERS_PER_USER = 4;

interface Stroke {
    id: string;
    user_id: string;
    color: string;
    size: number;
    points: number[];
}

interface Viewer {
    res: Response;
    client: string;
    userId: string;
}

interface Board {
    strokes: Stroke[];
    viewers: Set<Viewer>;
    points: number;
    channelId?: string;
    loaded?: Promise<void>;
    saveTimer?: ReturnType<typeof setTimeout>;
}

const boards = new Map<string, Board>();
const access = new Map<string, number>();
const instanceBoards = new Map<string, string>();
const spaceChannels = new Map<string, boolean>();
const pendingSaves = new Map<string, Promise<void>>();

const validStroke = (stroke: unknown): stroke is Stroke => {
    const value = stroke as Stroke;
    return (
        !!value &&
        typeof value.id === "string" &&
        typeof value.user_id === "string" &&
        typeof value.color === "string" &&
        typeof value.size === "number" &&
        Array.isArray(value.points) &&
        value.points.every((point) => typeof point === "number")
    );
};

export const parseSavedStrokes = (saved: unknown) => {
    const list = typeof saved === "string" ? (JSON.parse(saved) as unknown) : saved;
    return Array.isArray(list) ? list.filter(validStroke).slice(0, MAX_BOARD_STROKES) : [];
};

const loadBoard = async (board: Board) => {
    await pendingSaves.get(board.channelId!);
    const rows: { strokes: unknown }[] = await getDatabase()!.query(`SELECT "strokes" FROM "whiteboard_boards" WHERE "channel_id" = $1`, [board.channelId]);
    if (!rows.length) return;
    board.strokes = parseSavedStrokes(rows[0].strokes);
    board.points = board.strokes.reduce((total, stroke) => total + stroke.points.length / 2, 0);
};

const writeBoard = (channelId: string, strokes: Stroke[]) =>
    getDatabase()!
        .query(
            `INSERT INTO "whiteboard_boards" ("channel_id", "strokes", "updated_at") VALUES ($1, ${isSqlite() ? "$2" : "CAST($2 AS jsonb)"}, ${sqlNow()})
            ON CONFLICT ("channel_id") DO UPDATE SET "strokes" = EXCLUDED."strokes", "updated_at" = EXCLUDED."updated_at"`,
            [channelId, JSON.stringify(strokes)],
        )
        .then(() => undefined)
        .catch((error) => console.warn("[Whiteboard] Could not save the board:", (error as Error).message));

const saveBoard = (board: Board) => {
    clearTimeout(board.saveTimer);
    board.saveTimer = undefined;
    const channelId = board.channelId;
    if (!channelId) return Promise.resolve();
    const save = (pendingSaves.get(channelId) ?? Promise.resolve())
        .then(() => writeBoard(channelId, board.strokes))
        .finally(() => {
            if (pendingSaves.get(channelId) === save) pendingSaves.delete(channelId);
        });
    pendingSaves.set(channelId, save);
    return save;
};

const changed = (board: Board) => {
    if (!board.channelId) return;
    clearTimeout(board.saveTimer);
    board.saveTimer = setTimeout(() => void saveBoard(board), SAVE_DELAY);
    board.saveTimer.unref?.();
};

ProcessLifecycle.eventEmitter.once("stopping", async () => {
    await Promise.allSettled([...boards.values()].filter((board) => board.saveTimer).map(saveBoard));
});

const boardKeyFor = async (instance: ActivityInstance) => {
    let space = spaceChannels.get(instance.channel_id);
    if (space === undefined) {
        const channel = await Channel.findOne({ where: { id: instance.channel_id }, select: { id: true, type: true } });
        space = channel?.type === ChannelType.GUILD_SPACE;
        if (spaceChannels.size >= MAX_KNOWN_CHANNELS) spaceChannels.clear();
        spaceChannels.set(instance.channel_id, space);
    }
    return space ? { key: `channel:${instance.channel_id}`, channelId: instance.channel_id } : { key: instance.id };
};

const boardFor = (key: string, channelId?: string): Board | Promise<Board> => {
    let board = boards.get(key);
    if (!board) {
        const created: Board = { strokes: [], viewers: new Set(), points: 0, channelId };
        boards.set(key, (board = created));
        if (channelId)
            created.loaded = loadBoard(created)
                .catch((error) => console.warn("[Whiteboard] Could not load the board:", (error as Error).message))
                .finally(() => {
                    created.loaded = undefined;
                });
    }
    const loaded = board;
    return loaded.loaded ? loaded.loaded.then(() => loaded) : loaded;
};

const broadcast = (key: string, event: string, data: unknown, exceptClient?: string) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const viewer of boards.get(key)?.viewers ?? []) if (viewer.client !== exceptClient) viewer.res.write(payload);
};

const people = async (instanceId: string) => {
    const rows = await ActivityInstances.participants(instanceId);
    const ids = rows.map((r) => r.user_id);
    const users = ids.length
        ? await User.find({
              where: { id: In(ids) },
              select: { id: true, username: true, global_name: true, avatar: true },
          })
        : [];
    const guildId = (
        await ActivityInstance.findOne({
            where: { id: instanceId },
            select: { id: true, guild_id: true },
        })
    )?.guild_id;
    const members =
        guildId && ids.length
            ? await Member.find({
                  where: { guild_id: guildId, id: In(ids) },
                  select: { id: true, nick: true },
              })
            : [];
    const cdn = (Config.get().cdn.endpointPublic ?? "").replace(/\/$/, "");
    return rows.flatMap((row) => {
        const user = users.find((u) => u.id === row.user_id);
        if (!user) return [];
        const avatar = user.avatar
            ? `${cdn}/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith("a_") ? "gif" : "png"}?size=64`
            : `${cdn}/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
        return [
            {
                id: user.id,
                name: members.find((m) => m.id === user.id)?.nick || user.global_name || user.username,
                avatar,
            },
        ];
    });
};

ActivityInstances.onChange((instance, participants) => {
    const key = instanceBoards.get(instance.id) ?? instance.id;
    const board = boards.get(key);
    if (!board) return;
    if (participants.length) {
        void people(instance.id).then((list) => broadcast(key, "people", list));
        return;
    }
    broadcast(key, "ended", {});
    for (const viewer of board.viewers) viewer.res.end();
    instanceBoards.delete(instance.id);
    boards.delete(key);
    if (board.channelId) void saveBoard(board);
});

const authorize = async (req: Request, res: Response, next: NextFunction) => {
    const applicationId = res.locals.applicationId as string;
    const ticket = readProxyTicket(req.get("x-proxy-ticket") ?? req.query.ticket, applicationId);
    if (!ticket) return res.status(401).json({ message: "Invalid proxy ticket" });
    const instance = await ActivityInstances.find(applicationId, req.params.instance_id as string);
    if (!instance) return res.status(404).json({ message: "Unknown activity instance" });
    const key = `${instance.id}:${ticket.uid}`;
    if ((access.get(key) ?? 0) < Date.now()) {
        if (
            !(await ActivityInstanceParticipant.exists({
                where: { instance_id: instance.id, user_id: ticket.uid },
            }))
        )
            return res.status(403).json({ message: "You are not in this activity" });
        if (access.size >= MAX_ACCESS_ENTRIES) for (const [entry, until] of access) if (until < Date.now()) access.delete(entry);
        if (access.size < MAX_ACCESS_ENTRIES) access.set(key, Date.now() + ACCESS_TTL);
    }
    const board = await boardKeyFor(instance);
    instanceBoards.set(instance.id, board.key);
    res.locals.userId = ticket.uid;
    res.locals.instanceId = instance.id;
    res.locals.boardKey = board.key;
    res.locals.channelId = board.channelId;
    res.locals.client = String(req.get("x-client-id") ?? req.query.client ?? "").slice(0, 64);
    next();
};

const validPoints = (points: unknown): points is number[] =>
    Array.isArray(points) &&
    points.length > 0 &&
    points.length % 2 === 0 &&
    points.length <= MAX_BATCH_POINTS * 2 &&
    points.every((value, i) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= (i % 2 ? BOARD_HEIGHT : BOARD_WIDTH));

const api = Router({ mergeParams: true });
const json = express.json({ limit: "64kb" });

type BoardLocals = { instanceId: string; boardKey: string; channelId?: string; userId: string; client: string };

api.get("/instances/:instance_id/events", authorize, async (req: Request, res: Response) => {
    const { instanceId, boardKey, channelId, userId, client } = res.locals as BoardLocals;
    const found = boardFor(boardKey, channelId);
    const board = found instanceof Promise ? await found : found;
    if ([...board.viewers].filter((viewer) => viewer.userId === userId).length >= MAX_VIEWERS_PER_USER) return res.sendStatus(429);
    res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const viewer = { res, client, userId };
    board.viewers.add(viewer);
    res.write(`event: hello\ndata: ${JSON.stringify({ you: userId, width: BOARD_WIDTH, height: BOARD_HEIGHT, strokes: board.strokes, people: await people(instanceId) })}\n\n`);
    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 20_000);
    req.on("close", () => {
        clearInterval(keepAlive);
        board.viewers.delete(viewer);
        broadcast(boardKey, "cursor", { user_id: userId, x: null, y: null });
    });
});

api.post("/instances/:instance_id/strokes", json, authorize, async (req: Request, res: Response) => {
    const { boardKey, channelId, userId, client } = res.locals as BoardLocals;
    const { id, color, size, points } = req.body ?? {};
    if (typeof id !== "string" || !/^[\w-]{1,40}$/.test(id) || typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return res.sendStatus(400);
    if (typeof size !== "number" || size < 1 || size > 64 || !validPoints(points)) return res.sendStatus(400);

    const found = boardFor(boardKey, channelId);
    const board = found instanceof Promise ? await found : found;
    let stroke = board.strokes.findLast((s) => s.id === id && s.user_id === userId);
    if ((stroke?.points.length ?? 0) + points.length > MAX_STROKE_POINTS * 2 || board.points + points.length / 2 > MAX_BOARD_POINTS) return res.sendStatus(413);
    if (!stroke) {
        if (board.strokes.length >= MAX_BOARD_STROKES) return res.sendStatus(413);
        board.strokes.push((stroke = { id, user_id: userId, color, size, points: [] }));
    }
    const rounded = points.map((value) => Math.round(value * 10) / 10);
    stroke.points.push(...rounded);
    board.points += rounded.length / 2;
    changed(board);
    broadcast(boardKey, "points", { id, user_id: userId, color: stroke.color, size: stroke.size, points: rounded }, client);
    res.sendStatus(204);
});

api.post("/instances/:instance_id/cursor", json, authorize, (req: Request, res: Response) => {
    const { boardKey, userId, client } = res.locals as BoardLocals;
    const { x, y } = req.body ?? {};
    const visible = typeof x === "number" && typeof y === "number" && x >= 0 && x <= BOARD_WIDTH && y >= 0 && y <= BOARD_HEIGHT;
    broadcast(boardKey, "cursor", { user_id: userId, x: visible ? x : null, y: visible ? y : null }, client);
    res.sendStatus(204);
});

api.post("/instances/:instance_id/undo", authorize, async (req: Request, res: Response) => {
    const { boardKey, channelId, userId } = res.locals as BoardLocals;
    const found = boardFor(boardKey, channelId);
    const board = found instanceof Promise ? await found : found;
    const index = board.strokes.findLastIndex((s) => s.user_id === userId);
    if (index === -1) return res.sendStatus(204);
    const [stroke] = board.strokes.splice(index, 1);
    board.points -= stroke.points.length / 2;
    changed(board);
    broadcast(boardKey, "remove", { id: stroke.id, user_id: userId });
    res.sendStatus(204);
});

api.post("/instances/:instance_id/clear", authorize, async (req: Request, res: Response) => {
    const { boardKey, channelId, userId } = res.locals as BoardLocals;
    const found = boardFor(boardKey, channelId);
    const board = found instanceof Promise ? await found : found;
    board.strokes = [];
    board.points = 0;
    changed(board);
    broadcast(boardKey, "clear", { user_id: userId });
    res.sendStatus(204);
});

const router = Router();
router.use("/api", api);
router.use(
    express.static(path.join(ACTIVITY_ASSETS, "whiteboard"), {
        index: "index.html",
        maxAge: 0,
        setHeaders: (res) => res.set("Cache-Control", "no-cache"),
    }),
);

export const whiteboard: BuiltinActivity = {
    key: "whiteboard",
    name: "Whiteboard",
    description: "Sketch together on a shared board. Everyone in the call draws on the same page, live.",
    tags: ["drawing", "creative"],
    shelfRank: 1,
    icon: "icon.png",
    assets: [
        { name: "embedded_cover", file: "cover.png" },
        { name: "embedded_background", file: "cover.png" },
    ],
    router,
};
