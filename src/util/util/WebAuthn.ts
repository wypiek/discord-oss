import { Fido2Lib } from "fido2-lib";
import jwt from "jsonwebtoken";
import { JwtKeypairManager } from "./Token";

const jwtSignOptions: jwt.SignOptions = {
    algorithm: "ES512",
    expiresIn: "5m",
};

const jwtVerifyOptions: jwt.VerifyOptions = {
    algorithms: ["ES512"],
};

export const WebAuthn: {
    fido2: Fido2Lib | null;
    init: () => void;
} = {
    fido2: null,
    init: function () {
        this.fido2 = new Fido2Lib({
            challengeSize: 128,
        });
    },
};

export async function generateWebAuthnTicket(challenge: string): Promise<string> {
    return new Promise((res, rej) => {
        jwt.sign({ challenge }, JwtKeypairManager.keypair.privateKey, jwtSignOptions, (err, token) => {
            if (err || !token) return rej(err || "no token");
            return res(token);
        });
    });
}

export async function verifyWebAuthnToken(token: string) {
    return new Promise((res, rej) => {
        jwt.verify(token, JwtKeypairManager.keypair.publicKey, jwtVerifyOptions, (err, decoded) => {
            if (err) return rej(err);
            return res(decoded);
        });
    });
}
