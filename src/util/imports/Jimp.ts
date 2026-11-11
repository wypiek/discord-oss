/* eslint-disable @typescript-eslint/no-explicit-any */

export type JimpType = {
    read: (data: Buffer) => Promise<any>;
};
