export class GatewayLimits {
    retainedDispatchBytes: number = 1024 * 1024 * 1024;
    retainedDispatchBytesPerUser: number = 64 * 1024 * 1024;
    pendingConnectionsPerIp: number = 50;
}
