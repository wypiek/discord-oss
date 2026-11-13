import definePlugin from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";

const instanceIcon = "/favicon.svg";

export default definePlugin({
    name: "FosscordConnections",
    description: "Lists connection providers the instance offers that Discord's own client has no entry for, such as linking a discord.com account.",
    authors: [FosscordAuthor],
    required: true,

    extraPlatforms() {
        return [
            {
                type: "discord",
                name: "Discord",
                icon: {
                    lightPNG: instanceIcon,
                    darkPNG: instanceIcon,
                    whitePNG: instanceIcon,
                    lightSVG: instanceIcon,
                    darkSVG: instanceIcon,
                    whiteSVG: instanceIcon,
                },
                enabled: true,
                getPlatformUserUrl: ({ id }: { id: string }) => `https://discord.com/users/${encodeURIComponent(id)}`,
            },
        ];
    },

    patches: [
        {
            find: 'name:"Bluesky",icon:',
            replacement: {
                match: /let (\i)=\[(\{type:\i\.\i\.TWITCH,name:"Twitch")/,
                replace: "let $1=[...$self.extraPlatforms(),$2",
            },
        },
    ],
});
