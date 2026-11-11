import { In } from "typeorm";
import { Channel, Message, Recipient } from "@spacebar/database";
import { ChannelCreateEvent, ChannelFlags, DmChannelDTO, emitEvent } from "@spacebar/util";
import { ChannelType, MessageType } from "@spacebar/schemas";

const USER_MESSAGE_TYPES = [MessageType.DEFAULT, MessageType.REPLY, MessageType.APPLICATION_COMMAND, MessageType.CONTEXT_MENU_COMMAND];

async function findDirectMessage(user_id: string, other_id: string) {
    const own = await Recipient.find({ where: { user_id }, select: { channel_id: true } });
    if (!own.length) return null;
    const shared = await Recipient.find({
        where: { user_id: other_id, channel_id: In(own.map((recipient) => recipient.channel_id)) },
        relations: { channel: { recipients: true } },
    });
    return shared.map((recipient) => recipient.channel).find((channel) => channel.type === ChannelType.DM && channel.recipients?.length === 2) ?? null;
}

export async function openNewFriendDirectMessage(accepter_id: string, requester_id: string, note?: string | null) {
    const flag = Number(ChannelFlags.FLAGS.HAS_ONLY_SYSTEM_MESSAGES);
    let channel = await findDirectMessage(accepter_id, requester_id);
    if (!channel)
        channel = await Channel.create({
            type: ChannelType.DM,
            created_at: new Date(),
            e2ee_enabled_at: new Date(),
            flags: flag,
            nsfw: false,
            recipients: [accepter_id, requester_id].map((user_id) => Recipient.create({ user_id, closed: false })),
        }).save();
    else {
        const started = await Message.exists({ where: { channel_id: channel.id, type: In(USER_MESSAGE_TYPES) } });
        if (!started && !(channel.flags & flag)) {
            channel.flags |= flag;
            await Channel.update({ id: channel.id }, { flags: channel.flags });
        }
        const closed = channel.recipients!.filter((recipient) => recipient.closed || recipient.message_request_timestamp);
        for (const recipient of closed) Object.assign(recipient, { closed: false, message_request_timestamp: null });
        if (closed.length) await Recipient.save(closed);
    }
    await Channel.ensureDefaultPrivateEncryption(channel, accepter_id);
    await Channel.sendSystemMessage(channel, accepter_id, MessageType.FRIEND_REQUEST_ACCEPTED, { content: note ?? "" });
    const dto = await DmChannelDTO.from(channel);
    await Promise.all(
        [accepter_id, requester_id].map((user_id) =>
            emitEvent({
                event: "CHANNEL_CREATE",
                data: { ...dto.excludedRecipients([user_id]), is_message_request: false, is_message_request_timestamp: null, is_spam: false },
                user_id,
            } as ChannelCreateEvent),
        ),
    );
    return channel;
}
