import { ApplicationCommandType, InteractionType } from "@spacebar/schemas";
import { getDatabase } from "@spacebar/database";
import { Snowflake } from "@spacebar/util";
import { HTTPError } from "lambert-server/HTTPError";
import { ProcessLifecycle } from "../util/ProcessLifecycle";

export interface PendingInteraction {
    id: Snowflake;
    token: string;
    applicationId: string;
    userId: string;
    sessionId?: string;
    channelId: string;
    guildId?: string;
    nonce?: string;
    messageId?: string;
    messageEphemeral?: boolean;
    type: InteractionType;
    commandType?: ApplicationCommandType;
    commandName?: string;
    commandId?: string;
    commandOptions?: unknown[];
    targetId?: string;
    customId?: string;
    componentType?: number;
    authorizingOwners: Record<string, string>;
    forceEphemeral?: boolean;
    triggeringInteraction?: Omit<PendingInteraction, "triggeringInteraction">;
    acknowledged: boolean;
    failureSent?: boolean;
    responseMessageId?: string;
    responseEphemeral?: boolean;
    responseLoading?: boolean;
    modalComponents?: unknown[];
}

interface InteractionRow {
    acknowledged: boolean | number;
    interaction_state: string;
}

export const INTERACTION_TOKEN_LIFETIME = 15 * 60 * 1000;

let stopping = false;

ProcessLifecycle.eventEmitter.on("stopping", () => {
    stopping = true;
});

const query = async <T>(sql: string, parameters: unknown[]) => {
    const database = getDatabase();
    if (!database) throw new HTTPError("The database is not ready", 503);
    return (await database.query(sql, parameters)) as T[];
};

const fromRow = (row: InteractionRow | undefined): PendingInteraction | undefined =>
    row ? { ...(JSON.parse(row.interaction_state) as PendingInteraction), acknowledged: row.acknowledged === true || row.acknowledged === 1 } : undefined;

const serialise = ({ acknowledged, ...data }: PendingInteraction) => {
    void acknowledged;
    return JSON.stringify(data);
};

export async function storeInteraction(interaction: Omit<PendingInteraction, "acknowledged">): Promise<PendingInteraction> {
    if (stopping) throw new HTTPError("Server is shutting down", 503);
    const now = new Date();
    const stored: PendingInteraction = { ...interaction, acknowledged: false };
    await query("DELETE FROM pending_interactions WHERE expires_at <= $1", [now]);
    await query(
        `INSERT INTO pending_interactions (id, token, application_id, acknowledged, interaction_state, expires_at) VALUES ($1, $2, $3, false, $4, $5)
         ON CONFLICT (id) DO UPDATE SET token = EXCLUDED.token, application_id = EXCLUDED.application_id, acknowledged = false, interaction_state = EXCLUDED.interaction_state, expires_at = EXCLUDED.expires_at`,
        [stored.id, stored.token, stored.applicationId, serialise(stored), new Date(now.getTime() + INTERACTION_TOKEN_LIFETIME)],
    );
    return stored;
}

export async function findInteraction(id: Snowflake | string) {
    if (!/^\d{1,20}$/.test(String(id))) return undefined;
    const [row] = await query<InteractionRow>("SELECT acknowledged, interaction_state FROM pending_interactions WHERE id = $1 AND expires_at > $2", [id, new Date()]);
    return fromRow(row);
}

export async function getInteractionByToken(applicationId: string, token: string) {
    const [row] = await query<InteractionRow>("SELECT acknowledged, interaction_state FROM pending_interactions WHERE token = $1 AND application_id = $2 AND expires_at > $3", [
        token,
        applicationId,
        new Date(),
    ]);
    return fromRow(row);
}

export async function acknowledgeInteraction(interaction: PendingInteraction) {
    const result = await query<unknown>("UPDATE pending_interactions SET acknowledged = true WHERE id = $1 AND acknowledged = false AND expires_at > $2 RETURNING id", [
        interaction.id,
        new Date(),
    ]);
    const rows = Array.isArray(result[0]) ? result[0] : result;
    if (!rows.length) return false;
    interaction.acknowledged = true;
    return true;
}

export async function releaseInteraction(interaction: PendingInteraction) {
    interaction.acknowledged = false;
    await query("UPDATE pending_interactions SET acknowledged = false, interaction_state = $2 WHERE id = $1", [interaction.id, serialise(interaction)]);
}

export async function saveInteraction(interaction: PendingInteraction) {
    await query("UPDATE pending_interactions SET interaction_state = $2 WHERE id = $1", [interaction.id, serialise(interaction)]);
}
