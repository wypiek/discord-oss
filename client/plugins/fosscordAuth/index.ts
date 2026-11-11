import definePlugin from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";

export default definePlugin({
    name: "FosscordAuth",
    description: "Cancel pending passkey sign-in cleanly when the login screen changes or a password is submitted.",
    authors: [FosscordAuthor],
    required: true,
    patches: [
        {
            find: '"Login state reset"',
            replacement: {
                match: /(\i)\.abort\("(?:Login state reset|Starting password login|Transitioning to authenticated state)"\)/g,
                replace: "$1.abort()",
            },
        },
    ],
});
