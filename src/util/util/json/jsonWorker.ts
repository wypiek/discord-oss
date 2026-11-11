import { parentPort } from "node:worker_threads";

parentPort?.on("message", (message) => {
    try {
        if (message.type === "serialize") {
            const result = JSON.stringify(message.value);
            parentPort?.postMessage({ id: message.id, result });
        } else if (message.type === "deserialize") {
            const result = JSON.parse(message.json);
            parentPort?.postMessage({ id: message.id, result });
        } else throw new Error("Unknown JSON operation");
    } catch (error) {
        parentPort?.postMessage({ id: message.id, error: (error as Error).message });
    }
});
