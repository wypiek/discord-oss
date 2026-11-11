import definePlugin from "@utils/types";
import { React } from "@webpack/common";
import { MeowcordSpinner } from "../fosscordBranding/art";
import { FosscordAuthor } from "../fosscordCore/shared";

const env = () => (window as unknown as { GLOBAL_ENV: { LOADING_TIPS?: string[]; LOADING_SVG?: string } }).GLOBAL_ENV;

export default definePlugin({
    name: "FosscordLoading",
    description: "Show the instance's loading tips and animation.",
    authors: [FosscordAuthor],
    required: true,
    tip() {
        const tips = env().LOADING_TIPS;
        return tips?.length ? tips[Math.floor(Math.random() * tips.length)] : undefined;
    },
    animation(
        original: React.ReactElement<{
            className?: string;
            setRef?: (element: HTMLElement | null) => void;
        }>,
        ready: () => void,
    ) {
        const svg = env().LOADING_SVG;
        return svg ? (
            <img
                alt="Loading"
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
                onLoad={ready}
                onError={ready}
                style={{ width: 144, height: 144, objectFit: "contain" }}
            />
        ) : (
            <MeowcordSpinner className={original.props.className} setRef={original.props.setRef} onReady={ready} />
        );
    },
    patches: [
        {
            find: "_eventLoadingText=",
            replacement: [
                {
                    match: /_loadingText=\(function\(\)\{/,
                    replace: "$&const customTip=$self.tip();if(customTip!==undefined)return customTip;",
                },
                {
                    match: /\(0,\i\.jsx\)\(\i\.\i,\{autoPlay:!0,loop:!\i,setRef:this\.setVideoRef,onReady:this\.handleReady,className:.*?\}\)/,
                    replace: "$self.animation($&,this.handleReady)",
                },
            ],
        },
    ],
});
