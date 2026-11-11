import definePlugin from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";

const slowmodeBypassModule = String.raw`function \i\(\i,\i\)\{return \i\.can\(\i\.\i\.BYPASS_SLOWMODE,\i\)\}`;
const slowmodeBypassExpression = String.raw`(return )(\i\.can\(\i\.\i\.BYPASS_SLOWMODE,\i\))`;
const composerRejectionExpression = String.raw`(\.sendMessage\([^()]*\)\.catch\((\i)=>\{)throw(\(null!=(\i)\.scheduledTimestamp\|\|!1===\4\.eagerDispatch\)&&\i\(\)),\2\}\)`;

export default definePlugin({
    name: "FosscordSlowmode",
    description: "Apply the instance's slowmode policy to countdowns and message composition.",
    authors: [FosscordAuthor],
    required: true,
    allowBypass: () => (window as unknown as { GLOBAL_ENV?: { SLOWMODE_ALLOW_BYPASS?: boolean } }).GLOBAL_ENV?.SLOWMODE_ALLOW_BYPASS === true,
    isSlowmodeRejection(error: unknown) {
        const response = error as { status?: number; body?: { code?: number } } | undefined;
        return response?.status === 429 && response.body?.code === 20016;
    },
    patches: [
        {
            find: new RegExp(slowmodeBypassModule),
            replacement: {
                match: new RegExp(slowmodeBypassExpression),
                replace: "$1$self.allowBypass()&&$2",
            },
        },
        {
            find: ".handleSendMessage,onResize:",
            replacement: {
                match: new RegExp(composerRejectionExpression),
                replace: "$1$3;if(!$self.isSlowmodeRejection($2))throw $2;})",
            },
        },
    ],
});
