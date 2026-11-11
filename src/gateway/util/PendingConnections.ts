import { WebSocket } from "./WebSocket";

const pendingByAddress = new Map<string, number>();
const pendingSockets = new WeakMap<WebSocket, string>();

export const pendingConnections = (address: string) => pendingByAddress.get(address) ?? 0;

export function admitPendingConnection(socket: WebSocket, address: string | undefined, limit: number) {
    if (!address || limit <= 0) return true;
    const count = pendingConnections(address);
    if (count >= limit) return false;
    pendingByAddress.set(address, count + 1);
    pendingSockets.set(socket, address);
    return true;
}

export function settlePendingConnection(socket: WebSocket) {
    const address = pendingSockets.get(socket);
    if (address === undefined) return;
    pendingSockets.delete(socket);
    const remaining = pendingConnections(address) - 1;
    if (remaining > 0) pendingByAddress.set(address, remaining);
    else pendingByAddress.delete(address);
}
