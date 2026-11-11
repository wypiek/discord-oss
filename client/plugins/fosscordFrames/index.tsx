import definePlugin from "@utils/types";
import type { JSX } from "react";
import { useEffect, useRef } from "@webpack/common";

import { FosscordAuthor } from "../fosscordCore/shared";
import managedStyle from "./style.css?managed";

interface ProfileFrame {
    innerWidth: number;
    overflowTop: number;
    overflowBottom: number;
    overflowHorizontal: number;
}

const FRAMED = "fosscord-framed-sidebar";
const VARS = ["--fosscord-frame-top", "--fosscord-frame-bottom"];

// the profile frame across the whole side profile, like the profile popout, instead of only its top layers in the footer.
// Like discord's own side profile, the card keeps the full width and only moves down to make room for the art above it;
// the art reaching past its sides just hangs over the edges
function SidebarFrame({ Frame, frame }: { Frame: (props: { frame: ProfileFrame }) => JSX.Element; frame: ProfileFrame }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const sidebar = ref.current?.closest<HTMLElement>(".user-profile-sidebar");
        const space = sidebar?.parentElement;
        if (!sidebar || !space) return;
        const apply = () => {
            // the frame is drawn at the card's width
            const scale = space.clientWidth / frame.innerWidth;
            sidebar.style.setProperty(VARS[0], `${Math.round(frame.overflowTop * scale)}px`);
            sidebar.style.setProperty(VARS[1], `${Math.round(frame.overflowBottom * scale)}px`);
        };
        apply();
        sidebar.classList.add(FRAMED);
        const observer = new ResizeObserver(apply);
        observer.observe(space);
        return () => {
            observer.disconnect();
            sidebar.classList.remove(FRAMED);
            for (const name of VARS) sidebar.style.removeProperty(name);
        };
    }, [frame]);
    return (
        <div ref={ref} style={{ display: "contents" }}>
            <Frame frame={frame} />
        </div>
    );
}

export default definePlugin({
    name: "FosscordFrames",
    description: "Draws profile frames around the whole side profile in DMs, with room above and below the card for the art, instead of only their top layers in its footer.",
    authors: [FosscordAuthor],
    required: true,
    managedStyle,

    SidebarFrame,

    patches: [
        {
            // the side profile's footer, which draws the frame's top layers squeezed into it
            find: /\.xQ,children:\[\(0,\i\.jsx\)\(\i\.\i,\{frame:\i,filterLayer:\i\}\)/,
            replacement: {
                match: /\.xQ,children:\[\(0,(\i)\.jsx\)\((\i\.\i),\{frame:(\i),filterLayer:\i\}\)/,
                replace: ".xQ,children:[(0,$1.jsx)($self.SidebarFrame,{Frame:$2,frame:$3})",
            },
        },
    ],
});
