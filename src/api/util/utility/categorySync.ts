import { Channel } from "@spacebar/database";
import { ChannelPermissionOverwrite, ChannelType } from "@spacebar/schemas";
import { ChannelUpdateEvent, emitEvent } from "@spacebar/util";

const overwriteKey = (overwrites: ChannelPermissionOverwrite[] = []) =>
    overwrites
        .map((overwrite) => `${overwrite.id}:${Number(overwrite.type)}:${BigInt(overwrite.allow || 0)}:${BigInt(overwrite.deny || 0)}`)
        .sort()
        .join("|");

export const sameOverwrites = (a?: ChannelPermissionOverwrite[], b?: ChannelPermissionOverwrite[]) => overwriteKey(a) === overwriteKey(b);

export const copyOverwrites = (overwrites: ChannelPermissionOverwrite[] = []) => overwrites.map((overwrite) => ({ ...overwrite }));

export const syncedChildren = <T extends Pick<Channel, "permission_overwrites">>(before: ChannelPermissionOverwrite[] | undefined, children: T[]) =>
    children.filter((child) => sameOverwrites(child.permission_overwrites, before));

export async function syncCategoryChildren(category: Channel, before: ChannelPermissionOverwrite[] | undefined) {
    if (category.type !== ChannelType.GUILD_CATEGORY || !category.guild_id || sameOverwrites(before, category.permission_overwrites)) return 0;
    const children = await Channel.find({ where: { parent_id: category.id, guild_id: category.guild_id } });
    const synced = syncedChildren(before, children);
    for (const child of synced) {
        child.permission_overwrites = copyOverwrites(category.permission_overwrites);
        await Channel.update({ id: child.id }, { permission_overwrites: child.permission_overwrites });
        child.position = await Channel.calculatePosition(child.id, category.guild_id);
        await emitEvent({
            event: "CHANNEL_UPDATE",
            data: child.toJSON(),
            guild_id: child.guild_id ?? undefined,
            channel_id: child.id,
        } satisfies ChannelUpdateEvent);
    }
    return synced.length;
}
