export const AVATAR_CORNER_RADIUS_FIELD = "avatar_corner_radius";
export const AVATAR_CORNER_RADIUS_MAX = 50;

export const isAvatarCornerRadius = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= AVATAR_CORNER_RADIUS_MAX;

export const readAvatarCornerRadius = (value: unknown) => (isAvatarCornerRadius(value) ? value : null);

export function withAvatarCornerRadius<T extends object>(user: T, radius: number | null | undefined, keepNull = false) {
    const value = readAvatarCornerRadius(radius);
    if (value !== null || keepNull) Object.assign(user, { [AVATAR_CORNER_RADIUS_FIELD]: value });
    else delete (user as Record<string, unknown>)[AVATAR_CORNER_RADIUS_FIELD];
    return user as T & { avatar_corner_radius?: number | null };
}
