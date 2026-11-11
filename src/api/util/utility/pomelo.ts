import { User } from "@spacebar/database";
import { FieldErrors } from "@spacebar/util";

export const Pomelo = {
    validate(username: string) {
        if (username.length < 2 || username.length > 32)
            throw FieldErrors({
                username: { code: "BASE_TYPE_BAD_LENGTH", message: "Must be between 2 and 32 in length." },
            });
        if (!/^[a-z0-9_.]+$/.test(username) || username.includes(".."))
            throw FieldErrors({
                username: {
                    code: "USERNAME_INVALID_CHARACTERS",
                    message: "Username can only contain lowercase letters, numbers, underscores and periods, without consecutive periods.",
                },
            });
    },

    taken(username: string, except?: string) {
        return User.isUsernameTaken(username, except);
    },

    suggest(base?: string) {
        return User.suggestUsername(base ?? "");
    },
};
