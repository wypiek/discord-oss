import crypto from "node:crypto";

const vapidKeys = () => {
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.generateKeys();
    return {
        publicKey: ecdh.getPublicKey().toString("base64url"),
        privateKey: ecdh.getPrivateKey().toString("base64url"),
    };
};

export class WebPushConfiguration {
    enabled: boolean = true;
    subject: string | null = null;
    vapidPublicKey: string;
    vapidPrivateKey: string;

    constructor() {
        const keys = vapidKeys();
        this.vapidPublicKey = keys.publicKey;
        this.vapidPrivateKey = keys.privateKey;
    }
}
