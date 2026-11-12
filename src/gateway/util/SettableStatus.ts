import { User } from "@spacebar/database";
import { effectiveRights } from "@spacebar/util";

export const TESTING_STATUS = "testing";
const SettableStatuses = ["online", "idle", "dnd", "invisible", TESTING_STATUS];

export function canUseTestingStatus(user_id: string, rights: string | bigint | number | null | undefined) {
    return effectiveRights(user_id, rights).then((effective) => effective.has("TESTING_PRESENCE"));
}

export async function isSettableStatus(user_id: string, status: unknown, rights?: string | bigint | number | null) {
    if (typeof status !== "string" || !SettableStatuses.includes(status)) return false;
    if (status !== TESTING_STATUS) return true;
    const granted = rights ?? (await User.findOne({ where: { id: user_id }, select: { id: true, rights: true } }))?.rights;
    return canUseTestingStatus(user_id, granted);
}
