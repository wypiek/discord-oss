import { JsonInput } from "./JsonInput";

export async function* parseJsonArray<T>(chunks: AsyncIterable<string>, parse: (value: string) => Promise<T>): AsyncGenerator<T> {
    let started = false;
    let finished = false;
    let emptyAllowed = true;
    let input = new JsonInput();
    let depth = 0;
    let quoted = false;
    let escaped = false;
    try {
        for await (const chunk of chunks) {
            let segment = 0;
            for (let index = 0; index < chunk.length; index++) {
                const character = chunk[index];
                if (!started) {
                    segment = index + 1;
                    if (/[ \t\r\n]/.test(character)) continue;
                    if (character !== "[") throw new SyntaxError("Expected a JSON array");
                    started = true;
                    continue;
                }
                if (finished) {
                    segment = index + 1;
                    if (!/[ \t\r\n]/.test(character)) throw new SyntaxError("Unexpected content after JSON array");
                    continue;
                }
                if (!quoted && !depth && (character === "," || character === "]")) {
                    input.append(chunk.slice(segment, index));
                    segment = index + 1;
                    if (/^[ \t\r\n]*$/.test(input.value)) {
                        if (character !== "]" || !emptyAllowed) throw new SyntaxError("Missing JSON array item");
                    } else {
                        const parsed = await parse(input.value);
                        input.close();
                        input = new JsonInput();
                        emptyAllowed = false;
                        if (character === "]") finished = true;
                        yield parsed;
                    }
                    if (character === "]") finished = true;
                    else emptyAllowed = false;
                    continue;
                }
                if (quoted) {
                    if (escaped) escaped = false;
                    else if (character === "\\") escaped = true;
                    else if (character === '"') quoted = false;
                } else if (character === '"') quoted = true;
                else if (character === "[" || character === "{") depth++;
                else if ((character === "]" || character === "}") && depth) depth--;
            }
            if (started && !finished) input.append(chunk.slice(segment));
        }
        if (!finished) throw new SyntaxError("Incomplete JSON array");
    } finally {
        input.close();
    }
}
