import definePlugin from "@utils/types";

import { FosscordAuthor, redirectTo } from "../fosscordCore/shared";

const INCLUDED_IN_BOOSTING = "#{intl::hUgjyP::raw}";
const SHOW_BOOST_PROGRESS_BAR = "#{intl::Dl4mJS::raw}";

export default definePlugin({
    name: "FosscordNoBoostUpsells",
    description: "Every server is already boost level 3 here, so this removes Server Boost adverts and shows boost perks as unlocked.",
    authors: [FosscordAuthor],
    required: true,

    redirectTo,

    patches: [
        {
            find: 'key:"download",iconUrl:',
            replacement: {
                match: /=\i\?(?=\{key:"boost")/,
                replace: "=!1?",
            },
        },
        {
            find: /\.push\(\i\.\i\.GUILD_PREMIUM_PROGRESS_BAR\)/,
            replacement: [
                {
                    match: /\i(?=&&\i\.push\(\i\.\i\.GUILD_BOOSTS\))/,
                    replace: "!1",
                },
                {
                    match: /(?:\i\.premiumProgressBarEnabled|null)(?=&&\i>0&&\i\.push\(\i\.\i\.GUILD_PREMIUM_PROGRESS_BAR\))/,
                    replace: "!1",
                },
            ],
        },
        {
            find: 'id:"premium-subscribe",',
            replacement: {
                match: /\(0,\i\.jsx\)\(\i\.\i,\{id:"premium-subscribe",/,
                replace: "null&&$&",
            },
        },
        {
            find: INCLUDED_IN_BOOSTING,
            replacement: {
                match: /=function\(\i\)\{(?=let \i,\i,\i,\{guildFeature:)/,
                replace: "$&return null;",
            },
        },
        {
            find: SHOW_BOOST_PROGRESS_BAR,
            replacement: {
                match: /\(0,\i\.jsx\)\(\i,\{canManageGuild:\i,premiumProgressBarEnabled:\i\.premiumProgressBarEnabled\}\),\(0,\i\.jsx\)\("div",\{className:\i\.\i\}\),/,
                replace: "",
            },
        },
        {
            find: "renderTierNone(){",
            replacement: [
                {
                    match: /renderProgressBar\(\i\)\{/,
                    replace: "$&return null;",
                },
                {
                    match: /0===\i\?this\.renderTierNone\(\):this\.renderSubscribers\(\)/,
                    replace: "null",
                },
            ],
        },
        {
            find: /isBannerVisible:\i,disableBoostClick:\i\}=\i/,
            replacement: {
                match: /if\(0===\i&&\i===\i\.\i\.NONE\)return null;(?=let \i=\i===\i\.\i\.NONE\?)/,
                replace: "return null;",
            },
        },
        {
            find: /\.SUPPRESS_PREMIUM_SUBSCRIPTIONS\),onChange:/,
            replacement: {
                match: /\(0,\i\.jsx\)\(\i\.\i,\{label:[^{}]{0,80},checked:!\(0,\i\.\i\)\(\i\.systemChannelFlags,\i\.\i\.SUPPRESS_PREMIUM_SUBSCRIPTIONS\)/,
                replace: "null&&$&",
            },
        },
        {
            find: /case \i\.\i\.GUILD_BOOSTS:return\(0,\i\.jsx\)\(\i,\{guildId:\i,powerupListingId:/,
            replacement: {
                match: /(case \i\.\i\.GUILD_BOOSTS:return)\(0,\i\.jsx\)\(\i,\{guildId:(\i),powerupListingId:[^}]+\}\)/,
                replace: '$1 $self.redirectTo("/channels/"+$2)',
            },
        },
    ],
});
