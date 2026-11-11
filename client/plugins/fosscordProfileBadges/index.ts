import definePlugin from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";

const DIRECTORY_STAFF_BADGE_ID = 22;
const STAFF_BADGE_ID = "1";

export default definePlugin({
    name: "FosscordProfileBadges",
    description: "Lets the badge customization panel reorder and hide this instance's own profile badges.",
    authors: [FosscordAuthor],
    required: true,
    directoryBadgeId: (id: string) => (id === STAFF_BADGE_ID || id.startsWith("staff-role-") ? DIRECTORY_STAFF_BADGE_ID : id),
    patches: [
        {
            find: "premium_tenure_1_month_v2:1",
            replacement: {
                match: /(function \i\((\i)\)\{let (\i)=\i\[\2\];if\(null!=\3\)return \3;let (\i)=\i\.\$\[\2\.toUpperCase\(\)\];return"number"==typeof \4\?\4:)void 0\}/,
                replace: "$1$self.directoryBadgeId($2)}",
            },
        },
    ],
});
