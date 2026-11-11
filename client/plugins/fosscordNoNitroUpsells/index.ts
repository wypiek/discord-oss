import definePlugin from "@utils/types";

import { FosscordAuthor, hideNotices, hideSetting, redirectHome } from "../fosscordCore/shared";

import { renderGradientToggle } from "./gradient";

const NITRO_WHEEL_PATH = "M16.23 12c0 1.29-.95 2.25-2.22 2.25A2.18 2.18 0 0 1 11.8 12c0-1.29";

const MAKE_IT_YOURS_ONLY_WITH_PREMIUM = "#{intl::np0X/u::raw}";

const INCLUDED_WITH_PREMIUM = "#{intl::rt69oo::raw}";

const WISHLIST = "#{intl::7lZ31J::raw}";

export default definePlugin({
    name: "FosscordNoNitroUpsells",
    description: "All features are free. Removes subscription adverts, trial prompts, billing pages and subscription badges.",
    hidden: true,
    authors: [FosscordAuthor],
    required: true,

    redirectHome,
    renderGradientToggle,

    patches: [
        {
            find: "showResetThemeButton:",
            replacement: {
                match: /(function \i\((\i)\)\{let\{user:\i,pendingAvatarSrc:\i,pendingColors:\i,onThemeColorsChange:\i,preventDisabled:\i,guildId:\i,className:\i,showPremiumIcon:\i=!0,showResetThemeButton:\i=!1,forcedDivider:\i\}=\2,(\i)=.{0,110}?\{primaryColor:(\i),secondaryColor:(\i)\}=.{0,1400}?children:\(0,\i\.jsxs\)\("div",\{className:\i\.\i,children:\[)/,
                replace: "$1$self.renderGradientToggle($2,$3?.themeColors,[$4,$5]),",
            },
        },
        hideNotices([
            "GIFTING_PROMOTION_REMINDER",
            "OUTBOUND_PROMOTION",
            "DETECTED_OFF_PLATFORM_PREMIUM_PERK",
            "DETECTED_OFF_PLATFORM_PREMIUM_PERK_UPSELL",
            "PREMIUM_TIER_2_TRIAL_ENDING",
            "PREMIUM_TIER_0_TRIAL_ENDING",
            "PREMIUM_TIER_2_DISCOUNT_ENDING",
            "PREMIUM_UNCANCEL",
            "PREMIUM_MISSING_PAYMENT",
            "PREMIUM_PAST_DUE_INVALID_PAYMENT",
            "PREMIUM_PAST_DUE_MISSING_PAYMENT",
            "PREMIUM_REACTIVATE",
            "PREMIUM_PAST_DUE_ONE_TIME_PAYMENT",
            "CHECKOUT_RECOVERY_NAGBAR",
            "PREMIUM_MARKETING_NAGBAR",
            "COD_3PP_NAGBAR",
            "YOUTUBE_3P_NAGBAR",
        ]),
        {
            find: '"nitro-tab-group"',
            replacement: {
                match: /\i\?(?=\(0,\i\.jsxs\)\("div",\{children:\[\(0,\i\.jsx\)\(\i,\{nitroTabButtonRef:)/,
                replace: "!1?",
            },
        },
        {
            find: "QUEST_HOME_DEPRECATED,render:",
            replacement: {
                match: /(path:\i\.\i\.APPLICATION_STORE,render:)\i/,
                replace: "$1$self.redirectHome",
            },
        },
        {
            find: ".BILLING_SECTION,{",
            replacement: [hideSetting("BILLING_SECTION"), hideSetting("ACCOUNT_FAMILY_CENTER_CATEGORY"), hideSetting("APPEARANCE_IN_APP_ICON_CATEGORY")],
        },
        {
            find: ".COLLECTIBLES_PROFILE_SETTINGS_UPSELL),",
            replacement: {
                match: /=function\(\)\{(?=let [^;]{0,80}?=\(0,\i\.\i\)\(\i\.\i\.COLLECTIBLES_PROFILE_SETTINGS_UPSELL\))/,
                replace: "$&return null;",
            },
        },
        {
            find: ".APPEARANCE_CUSTOM_THEMES_UPSELL,{",
            replacement: hideSetting("APPEARANCE_CUSTOM_THEMES_UPSELL", { replacesPredicate: true }),
        },
        {
            find: MAKE_IT_YOURS_ONLY_WITH_PREMIUM,
            replacement: {
                match: /(let (\i)=\(0,\i\.\i\)\(\{type:\i,isPreview:\i,isCoachmark:\i\}\).{0,600}?\.otherwise\(\(\)=>)\i\.intl\.string\(\i\.t\["np0X\/u"\]\)\);/,
                replace: "$1null);if($2==null)return null;",
            },
        },
        {
            find: NITRO_WHEEL_PATH,
            replacement: {
                match: /function \i\(\i\)\{(?=let\{size:\i="md",width:\i,height:\i,color:\i=\i\.\i\.colors\.INTERACTIVE_ICON_DEFAULT,colorClass:\i="",\.\.\.\i\}=\i,.{0,500}?M16\.23 12c0 1\.29)/,
                replace: "$&return null;",
            },
        },
        {
            find: /showPremiumIcon:\i=!1(?:,ref:\i)?\}=\i;/,
            replacement: {
                match: /showPremiumIcon:(\i)=!1(?:,ref:\i)?\}=(\i);/,
                replace: "$&$1=!1;",
            },
        },
        {
            find: '"sticker")',
            replacement: {
                match: /\i\.gifts\?\.button!=null(?=&&)/,
                replace: "!1",
            },
        },
        {
            find: /JSON\.parse\('\{"[\w+/]{6}":\["/,
            all: true,
            noWarn: true,
            replacement: [
                {
                    match: / Animated GIF emojis? may be used by members with [^."]+\./g,
                    replace: "",
                },
                {
                    match: / (?:Nitro|Premium) members will be able to access these sounds in any server(?: on [^."]+)?\./g,
                    replace: "",
                },
            ],
        },
        {
            find: new RegExp(String.raw`${INCLUDED_WITH_PREMIUM}\)\}\),!\i&&`),
            replacement: {
                match: new RegExp(
                    String.raw`(\i\?)\(0,\i\.jsxs\)\("div",\{className:\i\.\i,children:\[\(0,\i\.jsx\)\(\i\.\i,\{variant:"text-md\/semibold",children:\i\.intl\.string\(\i\.t${INCLUDED_WITH_PREMIUM}\)\}\),!\i&&\(0,\i\.jsx\)\(\i\.\i,\{[^{}]*?children:\i\.intl\.string\(\i\.t#{intl::nKdAlO::raw}\)\}\)\]\}\)`,
                ),
                replace: "$1null",
            },
        },
        {
            find: /color:"text-muted",children:\i\.intl\.string\(\i\.t#{intl::nKdAlO::raw}\)/,
            replacement: {
                match: /\i(?=&&\(0,\i\.jsx\)\(\i\.\i,\{variant:"text-xxs\/normal",color:"text-muted",children:\i\.intl\.string\(\i\.t#{intl::nKdAlO::raw}\)\}\))/,
                replace: "!1",
            },
        },
        {
            find: '"WishlistButton"',
            all: true,
            replacement: {
                match: /function \i\(\i\)\{(?=let\{skuId:\i,productName:\i,className:\i,disabled:)/,
                replace: "$&return null;",
            },
        },
        {
            find: new RegExp(String.raw`HeartIcon,\{size:"xs",color:"currentColor"\}\),onClick:\i,ariaLabel:\i\.intl\.string\(\i\.t${WISHLIST}\)`),
            all: true,
            replacement: {
                match: new RegExp(
                    String.raw`\(0,\i\.jsx\)\(\i,\{content:\(0,\i\.jsx\)\(\i\.HeartIcon,\{size:"xs",color:"currentColor"\}\),onClick:\i,ariaLabel:\i\.intl\.string\(\i\.t${WISHLIST}\)`,
                ),
                replace: "null&&$&",
            },
        },
        {
            find: new RegExp(String.raw`"aria-label":\i\.intl\.string\(\i\.t${WISHLIST}\),children:\(0,\i\.jsx\)\(\i\.HeartIcon`),
            all: true,
            replacement: {
                match: new RegExp(
                    String.raw`\(0,\i\.jsx\)\(\i\.\i,\{className:\i\.\i,onClick:\i,"aria-label":\i\.intl\.string\(\i\.t${WISHLIST}\),children:\(0,\i\.jsx\)\(\i\.HeartIcon,\{size:"xs",color:"currentColor"\}\)\}\)`,
                ),
                replace: "null&&$&",
            },
        },
        {
            find: /section:\i\.\i\.WISHLIST,showNewContentDot:/,
            all: true,
            replacement: {
                match: new RegExp(String.raw`\(\i\|\|!\i&&\i\)&&(?=\i\.push\(\{text:\i\.intl\.string\(\i\.t${WISHLIST}\),section:\i\.\i\.WISHLIST)`),
                replace: "!1&&",
            },
        },
        {
            find: /\[\i\.\i\.NITRO_HOME\]:\[/,
            replacement: {
                match: /(\[\i\.\i\.NITRO_HOME\]:)\[(?:\i\.intl\.string\(\i\.t(?:\.[\w$]+|\["[^"]+"\])\),?)+\]/,
                replace: "$1null",
            },
        },
    ],
});
