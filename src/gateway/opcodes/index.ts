import { WebSocket, Payload } from "@spacebar/gateway";
import { onHeartbeat } from "./Heartbeat";
import { onIdentify } from "./Identify";
import { onLazyRequest } from "./LazyRequest";
import { onPresenceUpdate } from "./PresenceUpdate";
import { onRequestGuildMembers } from "./RequestGuildMembers";
import { onResume } from "./Resume";
import { onVoiceStateUpdate } from "./VoiceStateUpdate";
import { onGuildSubscriptionsBulk } from "./GuildSubscriptionsBulk";
import { onStreamCreate } from "./StreamCreate";
import { onStreamDelete } from "./StreamDelete";
import { onStreamWatch } from "./StreamWatch";
import { onGuildSync } from "./GuildSync";
import { onRequestChannelStatuses } from "./RequestChannelStatuses";
import { onRequestChannelInfo } from "./RequestChannelInfo";
import { onCallConnect } from "./CallConnect";
import { onStreamSetPaused } from "./StreamSetPaused";
import { onRequestSoundboardSounds } from "./RequestSoundboardSounds";

export type OPCodeHandler = (this: WebSocket, data: Payload) => unknown;

export default {
    1: onHeartbeat,
    2: onIdentify,
    3: onPresenceUpdate,
    4: onVoiceStateUpdate,
    // 5: Voice Server Ping
    6: onResume,
    // 7: Reconnect: You should attempt to reconnect and resume immediately.
    8: onRequestGuildMembers,
    // 9: Invalid Session
    // 10: Hello
    12: onGuildSync, // technically deprecated, bt should be less finnicky?
    13: onCallConnect,
    14: onLazyRequest,
    18: onStreamCreate,
    19: onStreamDelete,
    20: onStreamWatch,
    21: () => {},
    22: onStreamSetPaused,
    31: onRequestSoundboardSounds,
    36: onRequestChannelStatuses,
    37: onGuildSubscriptionsBulk,
    40: onHeartbeat, // same as 1, except with extra data
    41: () => {}, // "Update Time Spent Session ID", just tracking nonsense
    43: onRequestChannelInfo, // extended op36...?
} as { [key: number]: OPCodeHandler };
