// Copyright Spacebar & contributors 2026 (AGPLv3)
import { AsyncLocalStorage } from "node:async_hooks";

export const storageOwnership = new AsyncLocalStorage<string>();
