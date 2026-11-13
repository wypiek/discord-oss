import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";
import { bracketMath, isDisplayMath, isMathToken, renderMath } from "./math";
import { mathSafeLineCount } from "./preview";
import managedStyle from "./style.css?managed";

const STYLESHEET_URL = "/assets/katex/katex.min.css";
const STYLESHEET_MARKER = "fosscordMath";

interface MarkdownNode {
    children: unknown[];
    text: string;
}

interface MathToken {
    type: string;
    content: string;
}

function loadStylesheet() {
    if (document.querySelector(`link[data-${STYLESHEET_MARKER}]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = STYLESHEET_URL;
    link.dataset[STYLESHEET_MARKER] = "";
    document.head.append(link);
}

function MathFormula({ html, display }: { html: string; display: boolean }) {
    return <span className={display ? "fosscord-math fosscord-math-display" : "fosscord-math"} dangerouslySetInnerHTML={{ __html: html }} />;
}

const SafeMathFormula = ErrorBoundary.wrap(MathFormula, { noop: true });

export default definePlugin({
    name: "FosscordMarkdownMath",
    description: "Typesets LaTeX math in the preview of Markdown file attachments.",
    authors: [FosscordAuthor],
    required: true,
    managedStyle,
    bracketMath,
    previewLines: (lines: string[] | undefined, wanted: number, markdown: boolean) => (markdown ? mathSafeLineCount(lines, wanted) : wanted),
    pushMath(parent: MarkdownNode, token: MathToken, key: number) {
        if (!isMathToken(token.type)) return false;
        const display = isDisplayMath(token.type);
        const html = renderMath(token.content, display);
        if (html == null) return false;
        loadStylesheet();
        parent.children.push(<SafeMathFormula key={key} html={html} display={display} />);
        parent.text += token.content;
        return true;
    },
    stop() {
        document.querySelector(`link[data-${STYLESHEET_MARKER}]`)?.remove();
    },
    patches: [
        {
            find: '"--custom-plaintext-preview-collapsed-lines":6',
            all: true,
            replacement: {
                match: /(\i)\?\.slice\(0,(\i)\)(?=\.join\("\\n"\)\?\?"",\i=\i\|\|\2<\i;return\(0,\i\.jsxs\)\("div",\{className:\i\(\)\(\i,\i\.\i\),children:\[\(0,\i\.jsx\)\(\i\.\i,\{className:\i\(\)\(\i\.\i,\{\[\i\.\i\]:!\i&&!(\i)\}\))/,
                replace: "$1?.slice(0,$self.previewLines($1,$2,$3))",
            },
        },
        {
            find: 'case"math_block":',
            replacement: [
                {
                    match: /allow_labels:!1\}\)/,
                    replace: "$&.use($self.bracketMath)",
                },
                {
                    match: /case"math_inline_double":(?=(\i)\.children\.push\(\(0,\i\.jsx\)\("code",\{className:"inline",children:(\i)\.content\},(\i)\)\))/,
                    replace: 'case"math_inline_double":if($self.pushMath($1,$2,$3))break;',
                },
                {
                    match: /case"math_block":(?=(\i)\.children\.push\(\(0,\i\.jsx\)\(\i\.\i,\{language:"latex",text:(\i)\.content\},(\i)\)\))/,
                    replace: 'case"math_block":if($self.pushMath($1,$2,$3))break;',
                },
            ],
        },
    ],
});
