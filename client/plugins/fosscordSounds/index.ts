import definePlugin from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";

// sounds this instance replaces, served from assets/public/sounds
const RINGTONE = "/assets/sounds/call_ringing.mp3";

export default definePlugin({
    name: "FosscordSounds",
    description: "Plays this instance's own ringtone for incoming calls, including the seasonal and rare variants of it.",
    authors: [FosscordAuthor],
    required: true,

    soundUrl(name: string | undefined) {
        return name?.startsWith("call_ringing") ? RINGTONE : undefined;
    },

    patches: [
        {
            // every sound the client plays goes through here: new Audio with src from the bundled mp3s
            find: /new Audio;\i\.src=\i\(\d+\)\(`\.\/\$\{this\.name\}\.mp3`\)/,
            replacement: {
                match: /(new Audio;(\i)\.src=)(.{0,300}?)(,\2\.onloadeddata=)/,
                replace: "$1($self.soundUrl(this.name??this.audio)??($3))$4",
            },
        },
    ],
});
