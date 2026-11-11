import definePlugin from "@utils/types";

import { FosscordAuthor } from "../fosscordCore/shared";

type Constraint = number | { ideal?: number; max?: number } | undefined;
type Quality = { width?: number; height?: number; framerate?: number };
type StreamParameter = {
    quality?: number;
    maxResolution?: { type: string; width: number; height: number };
    maxFrameRate?: number;
};

const constraintValue = (value: Constraint) => (typeof value === "number" ? value : (value?.ideal ?? value?.max));

export default definePlugin({
    name: "FosscordGoLive",
    description: "Announces the resolution and frame rate a browser Go Live stream really captures, so viewers see the right quality.",
    authors: [FosscordAuthor],
    required: true,

    withFrameRate(quality: Quality, constraints: { frameRate?: Constraint }) {
        const framerate = constraintValue(constraints.frameRate);
        if (framerate != null) quality.framerate = framerate;
    },

    syncStreamParameters(connection: { videoStreamParameters?: StreamParameter[] }, { width, height, framerate }: Quality) {
        if (!connection.videoStreamParameters) return;
        connection.videoStreamParameters = connection.videoStreamParameters.map((parameter) =>
            parameter.quality === 100
                ? {
                      ...parameter,
                      maxResolution: height ? { type: "fixed", width: width ?? Math.round((height / 9) * 16), height } : { type: "source", width: 0, height: 0 },
                      ...(framerate != null && { maxFrameRate: framerate }),
                  }
                : parameter,
        );
    },

    patches: [
        {
            find: "setDesktopInput=",
            replacement: {
                match: /(let (\i)=\i\.stream\.getVideoTracks\(\)\[0\]\.getConstraints\(\),(\i)=\{width:.+?)(this\.videoQualityManager\.setGoliveQuality\(\{encode:\3,capture:\3,bitrateMax:\i\}\))/,
                replace: "$1$self.withFrameRate($3,$2),$4,$self.syncStreamParameters(this,$3)",
            },
        },
    ],
});
