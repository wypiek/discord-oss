import { Config } from "./Config";
import { FieldErrors } from "./FieldError";
import { HTTPError } from "lambert-server/HTTPError";

export function ValidateName(name: string, minLength = 2, maxLength?: number) {
    const check_username = name.replace(/\s/g, "");
    if (!check_username) {
        throw FieldErrors({
            username: {
                code: "BASE_TYPE_REQUIRED",
                message: "common:field.BASE_TYPE_REQUIRED",
            },
        });
    }
    const general = Config.get();
    const maxUsername = maxLength ?? general.limits.user.maxUsername;
    if (check_username.length > maxUsername || check_username.length < minLength) {
        throw FieldErrors({
            username: {
                code: "BASE_TYPE_BAD_LENGTH",
                message: `Must be between ${minLength} and ${maxUsername} in length.`,
            },
        });
    }

    const { blockedContains, blockedEquals } = general.user;
    for (const word of blockedContains) {
        if (name.toLowerCase().includes(word)) {
            throw new HTTPError(`Username cannot contain "${word}"`, 400);
        }
    }

    for (const word of blockedEquals) {
        if (name.toLowerCase() === word) {
            throw new HTTPError(`Username cannot be "${word}"`, 400);
        }
    }
    return name;
}
