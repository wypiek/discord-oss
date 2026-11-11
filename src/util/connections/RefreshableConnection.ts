import { ConnectedAccount } from "../../database/entities";
import { Connection } from "./Connection";
import { ConnectedAccountCommonOAuthTokenResponse } from "@spacebar/schemas";

/**
 * A connection that can refresh its token.
 */
export abstract class RefreshableConnection extends Connection {
    refreshEnabled = true;

    /**
     * Refreshes the token for a connected account.
     * @param connectedAccount The connected account to refresh
     */
    abstract refreshToken(connectedAccount: ConnectedAccount): Promise<ConnectedAccountCommonOAuthTokenResponse>;

    /**
     * Refreshes the token for a connected account and saves it to the database.
     * @param connectedAccount The connected account to refresh
     */
    async refresh(connectedAccount: ConnectedAccount): Promise<ConnectedAccountCommonOAuthTokenResponse> {
        const tokenData = await this.refreshToken(connectedAccount);
        connectedAccount.token_data = { ...tokenData, fetched_at: Date.now() };
        await connectedAccount.save();
        return tokenData;
    }
}
