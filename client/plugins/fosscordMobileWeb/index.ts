import { getIntlMessage } from "@utils/discord";
import definePlugin, { StartAt } from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";
import { schedule, startBackButton, stopBackButton } from "./back";
import managedStyle from "./style.css?managed";

type Platform = { name?: string; version?: string; ua?: string };

export default definePlugin({
    name: "FosscordMobileWeb",
    description:
        "Keeps phone browsers in the web client: invite and template links open here instead of handing off to the Discord app, voice works in Chrome, Firefox, Opera and Samsung Internet on phones, and the back button closes the open menu, dialog or drawer before it leaves the page.",
    authors: [FosscordAuthor],
    required: true,
    managedStyle,
    startAt: StartAt.DOMContentLoaded,

    start: startBackButton,
    stop: stopBackButton,

    flux: {
        MOBILE_WEB_SIDEBAR_OPEN: schedule,
        MOBILE_WEB_SIDEBAR_CLOSE: schedule,
    },

    patches: [
        {
            find: '"guild_template_mobile"',
            replacement: [
                {
                    match: /\i\.Fr\|\|\i\.v1(?=\?\(0,\i\.jsx\)\(\i,\{inviteKey:\i,transitionTo:\i\},\i\))/,
                    replace: "!1",
                },
                {
                    match: /\i\.Fr\|\|\i\.v1(?=\?\(0,\i\.jsx\)\(\i,\{code:\i\},\i\))/,
                    replace: "!1",
                },
            ],
        },
        {
            find: "Set section: ",
            replacement: {
                match: /(?<=componentDidUpdate\(\i\)\{let\{section:(\i)\}=\i;)/,
                replace: "$1!==this.props.section&&this.state.sidebarOpen&&this.setState({sidebarOpen:!1});",
            },
        },
        {
            find: /mobileSidebarOpen:\i,toggleSidebar:\i/,
            replacement: {
                match: /(let (\i)=null!=\i&&null!=\i&&)(\i)(,\i=\i\.\i&&\(0,\i\.jsxs\)\("div",\{className:\i\(\)\(\i\.mobileContentHeader,\{\[\i\.hideHamburger\]:!\2\}\),children:\[\2&&\(0,\i\.jsx\)\(\i\.\i,\{onClick:\i)/,
                replace: '$1!$3$4,"aria-label":$self.backLabel()',
            },
        },
        {
            find: /"OculusBrowser"\)>-1,\i=\(\(\)=>/,
            replacement: {
                match: /(\i)=(\i\.n\(\i\));(?=let \i=parseInt\(\1\(\)\.version)/,
                replace: "$1=(g=>()=>$self.browser(g()))($2);",
            },
        },
    ],

    backLabel: () => getIntlMessage("BACK"),

    browser(platform: Platform) {
        const name = platform.name?.replace(/ Mobile$/, "");
        if (name !== "Samsung Internet") return { ...platform, name };
        return {
            ...platform,
            name: "Chrome",
            version: /Chrome\/([\d.]+)/.exec(platform.ua ?? "")?.[1] ?? platform.version,
        };
    },
});
