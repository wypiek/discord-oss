import { VoiceOPCodes, VoicePayload, WebRtcWebSocket } from "../util";
import { onBackendVersion } from "./BackendVersion";
import { onHeartbeat } from "./Heartbeat";
import { onIdentify } from "./Identify";
import { onResume } from "./Resume";
import { onSelectProtocol } from "./SelectProtocol";
import { onSpeaking } from "./Speaking";
import { onVideo } from "./Video";
import { onDaveInvalidCommitWelcome, onDaveReadyForTransition, onMlsCommitWelcome, onMlsKeyPackage } from "./Dave";

const ignore: OPCodeHandler = async () => {};

export type OPCodeHandler = (this: WebRtcWebSocket, data: VoicePayload) => Promise<void>;

export default {
    [VoiceOPCodes.HEARTBEAT]: onHeartbeat,
    [VoiceOPCodes.IDENTIFY]: onIdentify,
    [VoiceOPCodes.VOICE_BACKEND_VERSION]: onBackendVersion,
    [VoiceOPCodes.VIDEO]: onVideo,
    [VoiceOPCodes.SPEAKING]: onSpeaking,
    [VoiceOPCodes.SELECT_PROTOCOL]: onSelectProtocol,
    [VoiceOPCodes.RESUME]: onResume,
    [VoiceOPCodes.SESSION_UPDATE]: ignore,
    [VoiceOPCodes.MEDIA_SINK_WANTS]: ignore,
    [VoiceOPCodes.NO_ROUTE]: ignore,
    [VoiceOPCodes.DAVE_PROTOCOL_TRANSITION_READY]: onDaveReadyForTransition,
    [VoiceOPCodes.MLS_KEY_PACKAGE]: onMlsKeyPackage,
    [VoiceOPCodes.MLS_COMMIT_WELCOME]: onMlsCommitWelcome,
    [VoiceOPCodes.MLS_INVALID_COMMIT_WELCOME]: onDaveInvalidCommitWelcome,
} as { [key: number]: OPCodeHandler };
