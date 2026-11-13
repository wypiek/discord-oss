import { ConnectedAccount } from "@spacebar/database";
import { Connection, ConnectionLoader, FieldErrors } from "@spacebar/util";

export class DomainSettings {
    enabled: boolean = true;
}

const verifiedThroughDns = () =>
    FieldErrors({
        provider_id: {
            code: "DOMAIN_VERIFIED_THROUGH_DNS",
            message: "Domains are connected from the Connections settings with a DNS record or a file on the website.",
        },
    });

export default class DomainConnection extends Connection {
    public readonly id = "domain";
    public readonly friendlyName = "Domain";
    public readonly setupUrl = "";
    public readonly requiredScopes: string[] = [];
    settings: DomainSettings = new DomainSettings();

    init(): void {
        this.settings = ConnectionLoader.getConnectionConfig<DomainSettings>(this.id, this.settings);
    }

    public get isConfigured(): boolean {
        return true;
    }

    getAuthorizationUrl(): string {
        throw verifiedThroughDns();
    }

    async handleCallback(): Promise<ConnectedAccount | null> {
        throw verifiedThroughDns();
    }
}
