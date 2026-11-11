import definePlugin from "@utils/types";
import { FosscordAuthor } from "../fosscordCore/shared";

export default definePlugin({
    name: "FosscordOfficialMessages",
    description: "Allows replies to this instance's official account.",
    authors: [FosscordAuthor],
    required: true,
    patches: [
        {
            find: "isSystemDM(){let",
            replacement: {
                match: /isSystemDM\(\)\{let (\i)=this\.rawRecipients\[0\];return([^}]+)&&!0===\1\.system\}/,
                replace: 'isSystemDM(){let $1=this.rawRecipients[0];return $2&&!0===$1.system&&!($1.username==="official"&&$1.discriminator==="0")}',
            },
        },
    ],
});
