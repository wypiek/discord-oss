import definePlugin from "@utils/types";
import { findStoreLazy } from "@webpack";

import { FosscordAuthor } from "../fosscordCore/shared";

const DISCORD_WHITEBOARD_APPLICATION_ID = "1070087967294631976";

const GuildStore = findStoreLazy("GuildStore") as { getGuild(id: string): unknown };

let connectionOpened = false;

export default definePlugin({
    name: "FosscordServerHub",
    description: "Runs the Server Hub whiteboard widget on this instance's built-in Whiteboard activity and keeps a reloaded Server Hub page open until the server has loaded.",
    authors: [FosscordAuthor],
    required: true,
    whiteboardApplicationId: () =>
        (window as unknown as { GLOBAL_ENV?: { WHITEBOARD_APPLICATION_ID?: string | null } }).GLOBAL_ENV?.WHITEBOARD_APPLICATION_ID || DISCORD_WHITEBOARD_APPLICATION_ID,
    guildLoaded: (guildId: string) => connectionOpened || GuildStore.getGuild(guildId) != null,
    flux: {
        CONNECTION_OPEN() {
            connectionOpened = true;
        },
        LOGOUT() {
            connectionOpened = false;
        },
    },
    patches: [
        {
            find: `"${DISCORD_WHITEBOARD_APPLICATION_ID}"`,
            replacement: {
                match: new RegExp(`"${DISCORD_WHITEBOARD_APPLICATION_ID}"`),
                replace: "$self.whiteboardApplicationId()",
            },
        },
        {
            find: ".GUILD_SPACE:if(!",
            replacement: {
                match: /(\.GUILD_SPACE:if\(!\i\)return(\(0,\i\.\i\)\(\));)if\(!(\i)\)(return\(0,\i\.jsx\)\(\i\.\i,\{to:\i\.\i\.CHANNEL\((\i)\)\}\))/,
                replace: "$1if(!$3&&!$self.guildLoaded($5))return $2;if(!$3)$4",
            },
        },
    ],
});
