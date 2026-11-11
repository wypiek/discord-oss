import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { Channel, Message, Recipient } from "@spacebar/database";
import { ChannelType, MessageType } from "@spacebar/schemas";
import { ChannelFlags, DmChannelDTO } from "@spacebar/util";
import * as events from "@spacebar/util/util/ipc/Event";
import { openNewFriendDirectMessage } from "./newFriends";
import { markDirectMessageStarted } from "../handlers/DirectMessage";

const accepter = "100000000000000001";
const requester = "100000000000000002";
const ONLY_SYSTEM = Number(ChannelFlags.FLAGS.HAS_ONLY_SYSTEM_MESSAGES);

let emitted: Parameters<typeof events.emitEvent>[0][];
let systemMessages: { channel: Channel; author: string; type: MessageType; content?: string }[];
let saved: Channel[];

const recipient = (user_id: string, closed: boolean) => Object.assign(new Recipient(), { user_id, closed, message_request_timestamp: null });

beforeEach(() => {
    emitted = [];
    systemMessages = [];
    saved = [];
    mock.method(Recipient, "create", (data: Partial<Recipient>) => Object.assign(new Recipient(), data));
    mock.method(Channel, "create", (data: Partial<Channel>) =>
        Object.assign(new Channel(), data, {
            save: async function (this: Channel) {
                this.id = "900000000000000001";
                saved.push(this);
                return this;
            },
        }),
    );
    mock.method(Channel, "ensureDefaultPrivateEncryption", async () => {});
    mock.method(Channel, "sendSystemMessage", async (channel: Channel, author: string, type: MessageType, opts: { content?: string } = {}) => {
        systemMessages.push({ channel, author, type, content: opts.content });
        return new Message();
    });
    mock.method(DmChannelDTO, "users", async () => []);
    mock.method(events, "emitEvent", async (event: Parameters<typeof events.emitEvent>[0]) => {
        emitted.push(event);
    });
});

afterEach(() => mock.restoreAll());

test("new friends without a DM get one that both of them see, flagged for the wave, with the accepted request message", async () => {
    mock.method(Recipient, "find", async () => []);
    await openNewFriendDirectMessage(accepter, requester, "see you around");
    assert.equal(saved.length, 1);
    const [channel] = saved;
    assert.equal(channel.type, ChannelType.DM);
    assert.equal(channel.flags & ONLY_SYSTEM, ONLY_SYSTEM);
    assert.deepEqual(
        channel.recipients!.map((x) => [x.user_id, x.closed]),
        [
            [accepter, false],
            [requester, false],
        ],
    );
    assert.deepEqual(
        systemMessages.map((x) => [x.author, x.type, x.content]),
        [[accepter, MessageType.FRIEND_REQUEST_ACCEPTED, "see you around"]],
    );
    assert.deepEqual(emitted.map((x) => [x.event, x.user_id]).sort(), [
        ["CHANNEL_CREATE", accepter],
        ["CHANNEL_CREATE", requester],
    ]);
    for (const event of emitted) assert.equal((event.data as { flags: number }).flags & ONLY_SYSTEM, ONLY_SYSTEM);
});

test("an existing DM without a conversation is reopened for both and flagged for the wave", async () => {
    const existing = Object.assign(new Channel(), {
        id: "900000000000000002",
        type: ChannelType.DM,
        flags: 0,
        recipients: [recipient(accepter, true), recipient(requester, true)],
    });
    mock.method(Recipient, "find", async (options: { where: { channel_id?: unknown } }) =>
        options.where.channel_id ? [Object.assign(new Recipient(), { channel: existing })] : [{ channel_id: existing.id }],
    );
    mock.method(Message, "exists", async () => false);
    const updates: unknown[] = [];
    mock.method(Channel, "update", async (...args: unknown[]) => updates.push(args));
    const reopened: Recipient[][] = [];
    mock.method(Recipient, "save", async (rows: Recipient[]) => reopened.push(rows));
    await openNewFriendDirectMessage(requester, accepter);
    assert.equal(saved.length, 0);
    assert.equal(existing.flags & ONLY_SYSTEM, ONLY_SYSTEM);
    assert.equal(updates.length, 1);
    assert.deepEqual(
        reopened.flat().map((x) => x.closed),
        [false, false],
    );
    assert.deepEqual(
        systemMessages.map((x) => [x.channel.id, x.author, x.content]),
        [[existing.id, requester, ""]],
    );
});

test("an existing DM with a conversation keeps its flags", async () => {
    const existing = Object.assign(new Channel(), {
        id: "900000000000000003",
        type: ChannelType.DM,
        flags: 0,
        recipients: [recipient(accepter, false), recipient(requester, false)],
    });
    mock.method(Recipient, "find", async (options: { where: { channel_id?: unknown } }) =>
        options.where.channel_id ? [Object.assign(new Recipient(), { channel: existing })] : [{ channel_id: existing.id }],
    );
    mock.method(Message, "exists", async () => true);
    const updates: unknown[] = [];
    mock.method(Channel, "update", async (...args: unknown[]) => updates.push(args));
    await openNewFriendDirectMessage(accepter, requester);
    assert.equal(existing.flags & ONLY_SYSTEM, 0);
    assert.equal(updates.length, 0);
    assert.equal(systemMessages.length, 1);
});

test("the first real message in a flagged DM clears the wave flag for both people", async () => {
    let affected = 1;
    const queries: unknown[] = [];
    const builder = {
        update: () => builder,
        set: (value: unknown) => {
            queries.push(value);
            return builder;
        },
        where: (...args: unknown[]) => {
            queries.push(args);
            return builder;
        },
        execute: async () => ({ affected }),
    };
    mock.method(Channel, "createQueryBuilder", () => builder);
    const updates: Channel[] = [];
    mock.method(Channel, "emitPrivateChannelUpdate", async (channel: Channel) => {
        updates.push(channel);
    });
    const flagged = Object.assign(new Channel(), { id: "900000000000000004", type: ChannelType.DM, flags: ONLY_SYSTEM | 1, recipients: [recipient(accepter, false)] });
    await markDirectMessageStarted(flagged);
    assert.equal(flagged.flags, 1);
    assert.equal(updates.length, 1);
    affected = 0;
    await markDirectMessageStarted(Object.assign(new Channel(), { id: "900000000000000005", type: ChannelType.DM, flags: ONLY_SYSTEM, recipients: [] }));
    assert.equal(updates.length, 1);
    await markDirectMessageStarted(Object.assign(new Channel(), { id: "900000000000000006", type: ChannelType.DM, flags: 0 }));
    await markDirectMessageStarted(Object.assign(new Channel(), { id: "900000000000000007", type: ChannelType.GROUP_DM, flags: ONLY_SYSTEM }));
    assert.equal(queries.length, 4);
});
