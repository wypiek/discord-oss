import { randomBytes } from "node:crypto";
import { IsNull } from "typeorm";
import { ChannelType } from "@spacebar/schemas";
import { Config, emitEvent } from "@spacebar/util/util";
import { Channel } from "../entities/Channel";
import { Member } from "../entities/Member";
import { VoiceState } from "../entities/VoiceState";
import { PrivateCalls } from "./PrivateCalls";
import { GoLiveStreams } from "./StreamPreviews";
import { StageInstances } from "./StageInstances";
import { ScheduledEvents } from "./ScheduledEvents";
import { ActivityInstances } from "./ActivityInstances";
import { GuildInsights } from "../insights/GuildInsights";

export class VoiceChannels {
    static async startTime(channelId: string) {
        const row = await VoiceState.createQueryBuilder("voice_state")
            .select("MIN(voice_state.connected_at)", "start")
            .addSelect("COUNT(*)", "count")
            .where("voice_state.channel_id = :channelId", { channelId })
            .getRawOne<{ start: string | null; count: string }>();
        if (!row || Number(row.count) === 0) return null;
        return row.start != null ? Number(row.start) : Math.floor(Date.now() / 1000);
    }

    static async occupancyChanged(guildId: string | null | undefined, channelId: string | null | undefined, userId: string, joined: boolean, connectedAt?: number | null) {
        if (!channelId) return;
        if (joined) GuildInsights.voiceJoined(guildId, channelId, userId);
        else GuildInsights.voiceLeft(guildId, channelId, connectedAt);
        if (!joined) {
            await GoLiveStreams.end(userId);
            await ActivityInstances.userLeftChannel(channelId, userId);
        }
        if (!guildId) return joined ? PrivateCalls.join(channelId, userId) : PrivateCalls.leave(channelId);

        const voiceStartTime = await VoiceChannels.startTime(channelId);
        await emitEvent({
            event: "VOICE_CHANNEL_START_TIME_UPDATE",
            guild_id: guildId,
            data: { id: channelId, guild_id: guildId, voice_start_time: voiceStartTime },
        });
        if (voiceStartTime !== null) return StageInstances.speakersChanged(channelId);
        await StageInstances.delete(channelId);
        await ScheduledEvents.channelEnded(channelId);

        const channel = await Channel.findOne({
            where: { id: channelId },
            select: { id: true, status: true },
        });
        if (!channel?.status) return;
        await Channel.update({ id: channelId }, { status: null });
        await emitEvent({
            event: "VOICE_CHANNEL_STATUS_UPDATE",
            guild_id: guildId,
            data: { id: channelId, guild_id: guildId, status: null },
        });
    }

    static async publish(voiceState: VoiceState, extra: { channel_id?: string | null } = {}) {
        const member = await Member.findOne({
            where: { id: voiceState.user_id, guild_id: voiceState.guild_id },
            relations: { user: true, roles: true },
        });
        await emitEvent({
            event: "VOICE_STATE_UPDATE",
            guild_id: voiceState.guild_id,
            data: { ...voiceState.toPublicVoiceState(), ...extra, member: member?.toPublicMember() },
        });
    }

    static async setServerMute(guildId: string, userId: string, changes: { mute?: boolean; deaf?: boolean }) {
        const voiceState = await VoiceState.findOne({ where: { user_id: userId, guild_id: guildId } });
        if (!voiceState?.channel_id) return;
        if (changes.mute !== undefined) voiceState.mute = changes.mute;
        if (changes.deaf !== undefined) voiceState.deaf = changes.deaf;
        await voiceState.save();
        await VoiceChannels.publish(voiceState);
    }

    static async evict(guildId: string, channelId: string) {
        const voiceStates = await VoiceState.find({
            where: { guild_id: guildId, channel_id: channelId },
            select: { user_id: true },
        });
        for (const { user_id } of voiceStates) await VoiceChannels.move(guildId, user_id, null);
    }

    static async leaveCall(channelId: string, userId: string) {
        const voiceState = await VoiceState.findOne({ where: { user_id: userId, channel_id: channelId, guild_id: IsNull() } });
        if (!voiceState) return false;
        const connectedAt = voiceState.connected_at;
        voiceState.channel_id = null as unknown as string;
        voiceState.self_stream = false;
        voiceState.self_video = false;
        voiceState.connected_at = null;
        await voiceState.save();
        await emitEvent({
            event: "VOICE_STATE_UPDATE",
            channel_id: channelId,
            data: { ...voiceState.toPublicVoiceState(), guild_id: null },
        });
        await VoiceChannels.occupancyChanged(null, channelId, userId, false, connectedAt);
        return true;
    }

    static async move(guildId: string, userId: string, channelId: string | null) {
        const voiceState = await VoiceState.findOne({ where: { user_id: userId, guild_id: guildId } });
        if (!voiceState?.channel_id || voiceState.channel_id === channelId) return false;
        const previousChannel = voiceState.channel_id;

        const connectedAt = voiceState.connected_at;

        if (!channelId) {
            voiceState.channel_id = null as unknown as string;
            voiceState.guild_id = null as unknown as string;
            voiceState.self_stream = false;
            voiceState.self_video = false;
            voiceState.connected_at = null;
            await voiceState.save();
            await VoiceChannels.publish(Object.assign(VoiceState.create({ ...voiceState }), { guild_id: guildId }), { channel_id: null });
            await VoiceChannels.occupancyChanged(guildId, previousChannel, userId, false, connectedAt);
            return true;
        }

        const target = await Channel.findOne({
            where: { id: channelId, guild_id: guildId },
            select: { id: true, type: true },
        });
        if (!target || ![ChannelType.GUILD_VOICE, ChannelType.GUILD_STAGE_VOICE].includes(target.type)) return false;
        voiceState.channel_id = channelId;
        voiceState.connected_at = Math.floor(Date.now() / 1000);
        voiceState.suppress = target.type === ChannelType.GUILD_STAGE_VOICE;
        voiceState.self_stream = false;
        voiceState.token = randomBytes(8).toString("hex");
        await voiceState.save();
        await VoiceChannels.publish(voiceState);
        await VoiceChannels.occupancyChanged(guildId, previousChannel, userId, false, connectedAt);
        await VoiceChannels.occupancyChanged(guildId, channelId, userId, true);

        const { regions } = Config.get();
        const region = regions.available.find((r) => r.id === regions.default);
        if (region)
            await emitEvent({
                event: "VOICE_SERVER_UPDATE",
                user_id: userId,
                data: { token: voiceState.token, guild_id: guildId, endpoint: region.endpoint },
            });
        return true;
    }
}
