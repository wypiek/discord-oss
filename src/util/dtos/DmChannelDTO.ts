import { In } from "typeorm";
import { Channel, User } from "../../database/entities";
import { PublicUser, PublicUserProjection } from "@spacebar/schemas";

export class DmChannelDTO {
    e2ee_enabled_at: string | null;
    flags: number;
    icon: string | null;
    id: string;
    last_message_id: string | null;
    name: string | null;
    origin_channel_id: string | null;
    owner_id?: string;
    recipients: PublicUser[];
    type: number;

    static async from(channel: Channel, excluded_recipients: string[] = [], origin_channel_id?: string, knownUsers?: Map<string, User>) {
        const obj = new DmChannelDTO();
        obj.e2ee_enabled_at = channel.e2ee_enabled_at?.toISOString() ?? null;
        obj.flags = channel.flags ?? 0;
        obj.icon = channel.icon || null;
        obj.id = channel.id;
        obj.last_message_id = channel.last_message_id || null;
        obj.name = channel.name || null;
        obj.origin_channel_id = origin_channel_id || null;
        obj.owner_id = channel.owner_id;
        obj.type = channel.type;
        const ids = channel.recipients?.map((r) => r.user_id).filter((id) => !excluded_recipients.includes(id)) ?? [];
        const byId = knownUsers ?? new Map((ids.length ? await DmChannelDTO.users(ids) : []).map((u) => [u.id, u]));
        obj.recipients = ids.flatMap((id) => byId.get(id)?.toPublicUser() ?? []);
        return obj;
    }

    static users(ids: string[]) {
        return User.find({
            where: { id: In(ids) },
            select: Object.fromEntries(PublicUserProjection.map((i) => [i, true])),
        });
    }

    excludedRecipients(excluded_recipients: string[]): DmChannelDTO {
        return {
            ...this,
            recipients: this.recipients.filter((r) => !excluded_recipients.includes(r.id)),
        };
    }
}
