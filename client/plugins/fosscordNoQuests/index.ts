import definePlugin from "@utils/types";

import { FosscordAuthor, hideNotices, redirectHome } from "../fosscordCore/shared";

export default definePlugin({
    name: "FosscordNoQuests",
    description: "Removes Quests, Orbs and sponsored content from the client.",
    authors: [FosscordAuthor],
    required: true,

    redirectHome,

    patches: [
        hideNotices(["QUEST_APP_UPSELL", "QUESTS_PROGRESS_INTERRUPTION"]),
        {
            find: '"nitro-tab-group"',
            replacement: {
                match: /\(0,\i\.jsx\)\(\i,\{selected:\i\.startsWith\(\i\.\i\.QUEST_HOME\)\},"quests"\)/,
                replace: "null",
            },
        },
        {
            find: "QUEST_HOME_DEPRECATED,render:",
            replacement: {
                match: /(path:\i\.\i\.QUEST_HOME,render:)\i/,
                replace: "$1$self.redirectHome",
            },
        },
        {
            find: ".DISCOVERY_QUEST_TAB_CLICKED,{",
            replacement: {
                match: /(function \i\((\i)\)\{)(let\{tab:\i\}=\i,\i=\i\.\i\.useField\("selectedTab"\).{0,200}?case (\i\.GlobalDiscoveryTab)\.QUESTS:)/,
                replace: "$1if($2.tab===$4.QUESTS)return null;$3",
            },
        },
        {
            find: "topLevelRoute:!1})",
            replacement: {
                match: /(case (\i\.GlobalDiscoveryTab)\.SERVERS:return(\(0,\i\.jsx\)\(\i,\{\}\));.{0,80}?case \2\.QUESTS:return)\(0,\i\.jsx\)\(\i\.default,\{topLevelRoute:!1\}\)/,
                replace: "$1$3",
            },
        },
        {
            find: /\[\i\.\i\.SHOP_ORBS_TAB\]:\[/,
            replacement: {
                match: /(\[\i\.\i\.(?:SHOP_ORBS_TAB|QUEST_ORBS|QUEST_HOME)\]:)\[(?:\i\.intl\.string\(\i\.t(?:\.[\w$]+|\["[^"]+"\])\),?)+\]/g,
                replace: "$1null",
            },
        },
        {
            find: /key:\i\.\i\.ORBS,text:/,
            replacement: {
                match: /,\{type:"page",key:(\i\.\i)\.ORBS,text:.{0,160}?onClick:\(\)=>\i\(\1\.ORBS\)\}(?=\])/,
                replace: "",
            },
        },
        {
            find: 'location:"BalanceWidgetMenu"',
            replacement: {
                match: /function \i\(\i\)\{(?=let\{showNotificationBadge:\i,ctaText:\i,ctaOnClick:\i,(?:onNavigate:\i,)?analyticsPage:)/,
                replace: "$&return null;",
            },
        },
    ],
});
