import definePlugin from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";
import managedStyle from "./style.css?managed";

const INCONSOLATA = 100;

export default definePlugin({
    name: "FosscordDisplayNameFonts",
    description: "Adds the instance's own display name fonts, starting with Inconsolata Ultra Expanded Bold.",
    authors: [FosscordAuthor],
    required: true,
    managedStyle,
    fontName: (fontId: number) => (fontId === INCONSOLATA ? "Inconsolata" : null),
    patches: [
        {
            find: '.HEXAGON=17]="HEXAGON"',
            all: true,
            replacement: {
                match: /(\i)\[\1\.HEXAGON=17\]="HEXAGON",/,
                replace: '$&$1[$1.INCONSOLATA_ULTRA_EXPANDED=100]="INCONSOLATA_ULTRA_EXPANDED",',
            },
        },
        {
            find: /\[\i\.\i\.PLAYPEN_SANS,\i\.\i\.ORBITRON,\i\.\i\.NEW_ROCKER,\i\.\i\.KALAM\]/,
            replacement: {
                match: /(\[\i\.\i\.PLAYPEN_SANS,\i\.\i\.ORBITRON,\i\.\i\.NEW_ROCKER,\i\.\i\.KALAM)\]/,
                replace: "$1,100]",
            },
        },
        {
            find: /\[\i\.\i\.KALAM\]:\i\.\i\};function \i\(\i\)\{return\{name:/,
            all: true,
            replacement: [
                {
                    match: /(\[\i\.\i\.KALAM\]:\i\.\i)\};function (\i)\((\i)\)\{return\{name:(\(0,\i\.\i\)\(\3\))/,
                    replace: '$1,100:"fosscordInconsolata"};function $2($3){return{name:$self.fontName($3)??$4',
                },
            ],
        },
    ],
});
