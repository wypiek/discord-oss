const unavailable = (name: string) =>
    class {
        constructor() {
            throw new Error(`${name} is not available on Cloudflare Workers`);
        }
    };

const refuse = (name: string) => () => {
    throw new Error(`${name} is not available on Cloudflare Workers`);
};

export const DgramSocket = unavailable("node-unix-socket");
export const Database = unavailable("bun:sqlite");
export const S3 = unavailable("@aws-sdk/client-s3");
export const hash = refuse("bcrypt");
export const compare = refuse("bcrypt");
export const hashSync = refuse("bcrypt");
export const compareSync = refuse("bcrypt");
export const genSalt = refuse("bcrypt");
export const genSaltSync = refuse("bcrypt");
export default { hash, compare, hashSync, compareSync, genSalt, genSaltSync };
