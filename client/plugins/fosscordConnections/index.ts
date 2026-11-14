import definePlugin from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";

const instanceIcon = "/favicon.svg";
const lastFmIcon = "/assets/connections/lastfm.svg";
const extraPlatformTypes = new Set(["discord", "lastfm"]);

const icons = (url: string) => ({ lightPNG: url, darkPNG: url, whitePNG: url, lightSVG: url, darkSVG: url, whiteSVG: url });

export default definePlugin({
    name: "FosscordConnections",
    description: "Lists connection providers the instance offers that Discord's own client has no entry for, such as a discord.com or Last.fm account.",
    authors: [FosscordAuthor],
    required: true,

    isExtraPlatform(type: unknown) {
        return extraPlatformTypes.has(type as string);
    },

    extraPlatforms() {
        return [
            {
                type: "discord",
                name: "Discord",
                icon: icons(instanceIcon),
                enabled: true,
                getPlatformUserUrl: ({ id }: { id: string }) => `https://discord.com/users/${encodeURIComponent(id)}`,
            },
            {
                type: "lastfm",
                name: "Last.fm",
                icon: icons(lastFmIcon),
                enabled: true,
                getPlatformUserUrl: ({ name }: { name: string }) => `https://www.last.fm/user/${encodeURIComponent(name)}`,
            },
        ];
    },

    patches: [
        {
            find: '"HANDOFF_AUTHORIZED"',
            replacement: {
                match: /(\i)=(\i)\.get\("code"\),/,
                replace: '$1=$2.get("code")??$2.get("token"),',
            },
        },
        {
            find: 'icon.whiteSVG}")`',
            replacement: {
                match: /return null!=(\i)&&Object\.values\((\i\.\i)\)\.includes\(\1\)\?\1:null/,
                replace: "return null!=$1&&(Object.values($2).includes($1)||$self.isExtraPlatform($1))?$1:null",
            },
        },
        {
            find: 'name:"Bluesky",icon:',
            replacement: {
                match: /let (\i)=\[(\{type:\i\.\i\.TWITCH,name:"Twitch")/,
                replace: "let $1=[...$self.extraPlatforms(),$2",
            },
        },
    ],
});
