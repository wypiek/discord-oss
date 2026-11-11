import { getIntlMessageFromHash } from "@utils/discord";
import definePlugin from "@utils/types";
import { Text } from "@webpack/common";

import { FosscordAuthor, redirectTo } from "../fosscordCore/shared";

export default definePlugin({
    name: "FosscordDiscovery",
    description: "Shows an empty state in Discover when this instance has no servers to list yet, hides the Student Hubs tab, and sends /activities to the app directory.",
    authors: [FosscordAuthor],
    required: true,

    redirectTo,

    renderEmpty: () => (
        <Text variant="text-md/normal" color="text-muted" style={{ padding: "32px 0", textAlign: "center" }}>
            {getIntlMessageFromHash("MwjTvn")}
        </Text>
    ),

    patches: [
        {
            find: ".ImpressionNames.ACTIVITY_DETAILS,impressionProperties",
            replacement: {
                match: /(\(0,(\i)\.jsx\)\((\i\.\i),\{path:(\i\.\i)\.ACTIVITY,disableTrack:!0,children:\(0,\i\.jsx\)\(\i\.\i,\{to:\i\.\i\.ME\}\)\}\),)/,
                replace: '$1(0,$2.jsx)($3,{path:$4.ACTIVITIES,exact:!0,disableTrack:!0,children:$self.redirectTo("/discovery/applications")}),',
            },
        },
        {
            find: "DISCOVER_POPULAR}",
            replacement: {
                match: /(variant:"heading-lg\/semibold",color:"text-strong",children:\i\}\),\(0,(\i)\.jsx\)\(\i\.\i,\{children:)(\(0,\2\.jsx\)\("div",\{className:\i\.\i,children:(\i)\}\))/,
                replace: "$1$4.length===0?$self.renderEmpty():$3",
            },
        },
        {
            find: /\.EDUCATION,\i\.\i\.HUBS\]\.map\(/,
            replacement: {
                match: /(\.EDUCATION),\i\.\i\.HUBS\](?=\.map\()/,
                replace: "$1]",
            },
        },
    ],
});
