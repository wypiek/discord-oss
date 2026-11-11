import path from "node:path";
import { Server, traverseDirectory } from "lambert-server";
import { Router } from "express";

//if we're using ts-node, use ts files instead of js
const extension = Symbol.for("ts-node.register.instance") in process ? "ts" : "js";

const DEFAULT_FILTER = new RegExp("^([^.].*)(?<!\\.d).(" + extension + ")$");

export type BundledRoutes = Record<string, [file: string, module: unknown][]>;

let bundledRoutes: BundledRoutes | undefined;

export function useBundledRoutes(routes: BundledRoutes) {
    bundledRoutes = routes;
}

export function registerRoutes(server: Server, root: string, destRouter: Router | undefined = undefined) {
    const bundled = bundledRoutes?.[path.basename(root)];
    if (bundled) return Promise.resolve(bundled.map(([file, loaded]) => server.registerRoute(root, path.join(root, file), destRouter, loaded)));
    return traverseDirectory({ dirname: root, recursive: true, filter: DEFAULT_FILTER }, (file) => server.registerRoute(root, file, destRouter));
}
