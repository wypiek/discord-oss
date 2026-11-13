import { ConnectedAccount } from "../../database/entities";
import { Connection } from "./Connection";
import { ConnectedAccountCommonOAuthTokenResponse, ConnectedAccountTokenData } from "@spacebar/schemas";

const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export function isTokenExpired(tokenData: ConnectedAccountTokenData | null | undefined, now = Date.now()) {
    if (!tokenData) return true;
    const { expires_at, expires_in, fetched_at } = tokenData;
    if (expires_at && expires_at - TOKEN_EXPIRY_MARGIN_MS < now) return true;
    return !!expires_in && fetched_at + expires_in * 1000 - TOKEN_EXPIRY_MARGIN_MS < now;
}

/**
 * A connection that can refresh its token.
 */
export abstract class RefreshableConnection extends Connection {
    refreshEnabled = true;
    private pendingRefreshes = new Map<string, Promise<ConnectedAccountTokenData>>();

    /**
     * Refreshes the token for a connected account.
     * @param connectedAccount The connected account to refresh
     */
    abstract refreshToken(connectedAccount: ConnectedAccount): Promise<ConnectedAccountCommonOAuthTokenResponse>;

    /**
     * Refreshes the token for a connected account and saves it to the database.
     * @param connectedAccount The connected account to refresh
     */
    async refresh(connectedAccount: ConnectedAccount): Promise<ConnectedAccountTokenData> {
        const key = `${connectedAccount.user_id}:${connectedAccount.external_id}`;
        const pending = this.pendingRefreshes.get(key);
        if (pending) return pending;
        const work = this.refreshAndSave(connectedAccount).finally(() => this.pendingRefreshes.delete(key));
        this.pendingRefreshes.set(key, work);
        return work;
    }

    private async refreshAndSave(connectedAccount: ConnectedAccount): Promise<ConnectedAccountTokenData> {
        const tokenData = await this.refreshToken(connectedAccount);
        const merged: ConnectedAccountTokenData = {
            ...connectedAccount.token_data,
            ...tokenData,
            refresh_token: tokenData.refresh_token ?? connectedAccount.token_data?.refresh_token,
            expires_at: undefined,
            fetched_at: Date.now(),
        };
        connectedAccount.token_data = merged;
        await ConnectedAccount.update({ user_id: connectedAccount.user_id, external_id: connectedAccount.external_id, type: connectedAccount.type }, { token_data: merged });
        return merged;
    }
}
