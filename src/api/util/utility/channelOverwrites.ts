import { DiscordApiErrors, Permissions } from "@spacebar/util";
import type { ChannelPermissionOverwrite } from "@spacebar/schemas";

type OverwriteInput = Pick<ChannelPermissionOverwrite, "id" | "allow" | "deny">;

const bits = (value?: string | null) => {
    try {
        return BigInt(value || "0");
    } catch {
        throw DiscordApiErrors.INVALID_FORM_BODY;
    }
};

export function changedOverwriteBits(before: OverwriteInput[] = [], after: OverwriteInput[] = []) {
    const previous = new Map(before.map((overwrite) => [overwrite.id, overwrite]));
    const next = new Map(after.map((overwrite) => [overwrite.id, overwrite]));
    let changed = 0n;
    for (const id of new Set([...previous.keys(), ...next.keys()])) {
        const old = previous.get(id);
        const now = next.get(id);
        changed |= (bits(old?.allow) ^ bits(now?.allow)) | (bits(old?.deny) ^ bits(now?.deny));
    }
    return changed;
}

export function assertOverwriteChanges(permission: Permissions, before: OverwriteInput[] | undefined, after: OverwriteInput[], requireManageRoles: boolean) {
    const changed = changedOverwriteBits(before, after);
    if (!changed) return;
    if (requireManageRoles) permission.hasThrow("MANAGE_ROLES");
    if (permission.has("ADMINISTRATOR")) return;
    if (changed & (Permissions.FLAGS.MANAGE_ROLES | ~permission.bitfield)) throw DiscordApiErrors.MISSING_PERMISSIONS;
}
