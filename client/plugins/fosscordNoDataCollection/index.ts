import definePlugin from "@utils/types";

import { FosscordAuthor, hideSetting } from "../fosscordCore/shared";

export default definePlugin({
    name: "FosscordNoDataCollection",
    description: "This instance does no analytics, personalization or sponsored content, so the toggles for them are hidden.",
    authors: [FosscordAuthor],
    required: true,

    patches: [
        {
            find: ".DATA_USAGE_STATISTICS_SETTING,{",
            replacement: [
                hideSetting("DATA_USAGE_STATISTICS_SETTING"),
                hideSetting("DATA_USAGE_QUESTS_SETTING", { replacesPredicate: true }),
                hideSetting("DATA_USAGE_QUESTS_3P_SETTING", { replacesPredicate: true }),
                hideSetting("SPONSORED_CONTENT_QUESTS_SETTING", { replacesPredicate: true }),
                hideSetting("SPONSORED_CONTENT_QUESTS_3P_SETTING", { replacesPredicate: true }),
            ],
        },
        {
            find: ".DATA_USAGE_PERSONALIZATION_SETTING,{",
            replacement: hideSetting("DATA_USAGE_PERSONALIZATION_SETTING"),
        },
        {
            find: 'value:"Ads",label:',
            replacement: {
                match: /Ads:\{value:"Ads",label:[^}]+,checked:!1\},/,
                replace: "",
            },
        },
    ],
});
