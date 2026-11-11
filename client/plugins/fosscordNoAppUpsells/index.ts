import definePlugin from "@utils/types";

import { FosscordAuthor, hideNotices, hideSetting, redirectHome } from "../fosscordCore/shared";

export default definePlugin({
    name: "FosscordNoAppUpsells",
    description: "Removes every prompt to download the desktop or mobile apps, and the game library that only the desktop app fills.",
    authors: [FosscordAuthor],
    required: true,

    redirectHome,

    patches: [
        hideNotices(["DOWNLOAD_NAG"]),
        {
            find: '"app-download-button"',
            replacement: {
                match: /return(?=.{0,50}id:"app-download-button")/,
                replace: "return null;return",
            },
        },
        {
            find: 'key:"download",iconUrl:',
            replacement: {
                match: /\(0,\i\.isWeb\)\(\)(?=&&\i\.push\(\{key:"download")/,
                replace: "!1",
            },
        },
        {
            find: '"Help Text Output Devices"',
            replacement: {
                match: /null!=\i\?(?=\(0,\i\.jsx\)\(\i\.\i,\{(?:messageType:\i\.\i\.WARNING,children|type:"warning",message):\i\(\i\)\.getWarningMessage\(\)[,}])/,
                replace: "!1?",
            },
        },
        {
            find: ".SYSTEM_CUSTOM_KEYBINDS_CATEGORY,{",
            replacement: hideSetting("SYSTEM_CUSTOM_KEYBINDS_CATEGORY"),
        },
        {
            find: "QUEST_HOME_DEPRECATED,render:",
            replacement: {
                match: /(path:\i\.\i\.APPLICATION_LIBRARY,render:)\i/,
                replace: "$1$self.redirectHome",
            },
        },
    ],
});
