import { getIntlMessageFromHash } from "@utils/discord";
import definePlugin from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";

import { FosscordAuthor } from "../fosscordCore/shared";

const SuperReactionIcon = findComponentByCodeLazy("M19.09.63a.97.97 0 0 1 1.82 0l.34.93");

export default definePlugin({
    name: "FosscordSuperReactions",
    description: "Adds the Add Super Reaction button back to the message hover bar.",
    authors: [FosscordAuthor],
    required: true,
    SuperReactionIcon,
    superReactionLabel: () => getIntlMessageFromHash("kVfuVu"),
    patches: [
        {
            find: '"message_super_reaction_emoji_picker"',
            replacement: [
                {
                    match: /function (\i)\((\i)\)\{let\{channel:(\i),message:(\i),togglePopout:(\i),renderEmojiPicker:(\i),shouldShow:(\i)\}=\2,/,
                    replace: "function $1($2){let{channel:$3,message:$4,togglePopout:$5,renderEmojiPicker:$6,shouldShow:$7,fosscordSuperReaction=!1}=$2,",
                },
                {
                    match: /(let\{closePopout:(\i)\}=\i;return \i\(\i,\i,\2,)!1\)/,
                    replace: "$1fosscordSuperReaction)",
                },
                {
                    match: /label:(\i\.intl\.string\(\i\.t\.\i\)),icon:(\i\.\i),onClick:(\i)\},"add-reaction"\)/,
                    replace:
                        'label:fosscordSuperReaction?$self.superReactionLabel():$1,icon:fosscordSuperReaction?$self.SuperReactionIcon:$2,onClick:$3},fosscordSuperReaction?"add-super-reaction":"add-reaction")',
                },
                {
                    match: /function (\i)\((\i)\)\{let\{channel:(\i),message:(\i),canCopy:/,
                    replace: "function $1($2){let fosscordHoverBarProps=$2;let{channel:$3,message:$4,canCopy:",
                },
                {
                    match: /\(0,(\i)\.jsx\)\((\i),\{togglePopout:\i,renderEmojiPicker:(\i),shouldShow:\i,isFocused:(\i),channel:(\i),message:(\i)\}\)/,
                    replace:
                        '(0,$1.jsxs)($1.Fragment,{children:[$&,(0,$1.jsx)($2,{togglePopout:()=>fosscordHoverBarProps.setPopout({emojiBurstPicker:!fosscordHoverBarProps.showEmojiBurstPicker}),renderEmojiPicker:$3,shouldShow:fosscordHoverBarProps.showEmojiBurstPicker,isFocused:$4,channel:$5,message:$6,fosscordSuperReaction:!0},"fosscord-super-reaction")]})',
                },
            ],
        },
        {
            find: "onBurstReactionToggle:function",
            replacement: {
                match: /(analyticsOverride:(\i)=\i,.{0,1200}?\[\i,(\i)\]=(\i)\.useState\([^()]{1,200}\))(?=,\i=\i\.useRef\(null\),\i=\i\.default\.getCurrentUser\(\))/,
                replace: '$1,fosscordSuperReactionPicker=$4.useLayoutEffect(()=>{$2.openPopoutType==="message_super_reaction_emoji_picker"&&$3(!0)},[])',
            },
        },
    ],
});
