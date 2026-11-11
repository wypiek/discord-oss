export interface GuildGlobalDiscoverySchema {
    enabled: boolean;
}

export interface AdminFederationSettingsSchema {
    enabled?: boolean;
    /**
     * @maxLength 512
     */
    registryUrl?: string;
    /**
     * @maxLength 64
     */
    registryPublicKey?: string;
    announce?: boolean;
    announceStats?: boolean;
    allowUnlistedPeers?: boolean;
    /**
     * @maxItems 200
     * @TJS-type array
     * @items.type string
     * @items.maxLength 300
     */
    peers?: string[];
    /**
     * @maxItems 10
     * @TJS-type array
     * @items.type string
     * @items.maxLength 300
     */
    contacts?: string[];
    /**
     * @maxItems 10
     * @TJS-type array
     * @items.type string
     * @items.maxLength 300
     */
    previousIds?: string[];
    verification?: "registry" | "instance";
}

export interface AdminFederationBlockSchema {
    kind: "instance" | "guild" | "user";
    /**
     * @minLength 1
     * @maxLength 300
     */
    target: string;
    /**
     * @maxLength 1000
     */
    reason?: string;
}

export interface AdminFederationGuildSchema {
    verified?: boolean;
    hidden?: boolean;
}

export interface AdminFederationVerifySchema {
    /**
     * @minLength 1
     * @maxLength 300
     */
    id: string;
    verified: boolean;
}
