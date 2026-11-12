import definePlugin from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";

const TESTING = "testing";
const OPERATOR = 1n << 0n;
const TESTING_PRESENCE = 1n << 57n;
const TESTING_COLOR = "#3ba3e8";

let rights = 0n;

function parseRights(value: unknown) {
    try {
        return BigInt(typeof value === "string" || typeof value === "number" || typeof value === "bigint" ? value : 0);
    } catch {
        return 0n;
    }
}

export default definePlugin({
    name: "FosscordTestingStatus",
    description: "Adds the Testing status: a blue dot that mutes notifications like Do Not Disturb, for accounts with the TESTING_PRESENCE right.",
    authors: [FosscordAuthor],
    required: true,
    testingLabel: "Testing",
    testingDescription: "You will not receive desktop notifications",
    testingColor: { resolve: () => ({ hex: () => TESTING_COLOR }) },
    canUseTesting: () => (rights & (OPERATOR | TESTING_PRESENCE)) !== 0n,
    isQuiet: (status: unknown, dnd: unknown) => status === dnd || status === TESTING,
    flux: {
        CONNECTION_OPEN({ user }: { user?: { rights?: unknown } }) {
            rights = parseRights(user?.rights);
        },
    },
    patches: [
        {
            find: '.DND="dnd",',
            replacement: {
                match: /(\i)\.DND="dnd",/,
                replace: '$&$1.TESTING="testing",',
            },
        },
        {
            find: "unsafe_rawColors.GREEN_NEW_38;case",
            replacement: [
                {
                    match: /switch\((\i)\)\{case (\i\.\i)\.ONLINE:return (\i\.\i)\.unsafe_rawColors\.GREEN_NEW_38;/,
                    replace: 'switch($1){case "testing":return $self.testingColor;case $2.ONLINE:return $3.unsafe_rawColors.GREEN_NEW_38;',
                },
                {
                    match: /switch\((\i)\)\{case (\i\.\i)\.ONLINE:if\((\i)\)return\{bgRadius/,
                    replace: 'switch("testing"===$1?$2.ONLINE:$1){case $2.ONLINE:if($3)return{bgRadius',
                },
            ],
        },
        {
            find: /\{isMobile:\i=!1,isVR:\i=!1\}=\i;switch\(\i\)\{case \i\.\i\.ONLINE:if\(\i\)return/,
            replacement: {
                match: /(\{isMobile:\i=!1,isVR:\i=!1\}=\i;switch\(\i\)\{)/,
                replace: '$1case "testing":return $self.testingLabel;',
            },
        },
        {
            find: '"menu-separator-statuses"',
            all: true,
            group: true,
            replacement: [
                {
                    match: /((\i)\(\{status:(\i\.\i)\.DND,currentStatus:(\i),description:\i\(\3\.DND\)\}\))/,
                    replace: '$1,vcTestingStatus=$self.canUseTesting()?$2({status:"testing",currentStatus:$4,description:$self.testingDescription}):null',
                },
                {
                    match: /("menu-separator-statuses"\),\i,\i),/,
                    replace: "$1,vcTestingStatus,",
                },
            ],
        },
        {
            find: /\.getStatus\(\)===\i\.\i\.DND/,
            all: true,
            noWarn: true,
            replacement: {
                match: /(\i\.\i\.getStatus\(\))===(\i\.\i)\.DND/g,
                replace: "$self.isQuiet($1,$2.DND)",
            },
        },
        {
            find: /\i===\i\.\i\.IDLE\|\|\i===\i\.\i\.DND/,
            all: true,
            noWarn: true,
            replacement: {
                match: /(\i)===(\i\.\i)\.IDLE\|\|\1===\2\.DND/g,
                replace: '$&||$1==="testing"',
            },
        },
        {
            find: /\i!==\i\.\i\.IDLE&&\i!==\i\.\i\.DND/,
            all: true,
            noWarn: true,
            replacement: {
                match: /(\i)!==(\i\.\i)\.IDLE&&\1!==\2\.DND/g,
                replace: '$&&&$1!=="testing"',
            },
        },
    ],
});
