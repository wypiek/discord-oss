import { ChannelPermissionOverwrite } from "@spacebar/schemas";

export type ChannelPermissionOverwriteSchema = Pick<ChannelPermissionOverwrite, "type"> & Partial<Pick<ChannelPermissionOverwrite, "id" | "allow" | "deny">>;
