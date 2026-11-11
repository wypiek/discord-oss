const path = require("path");
const express = require("express");
const { traverseDirectory } = require("lambert-server");
const RouteUtility = require("../../dist/api/middlewares/Route.js");
const { greenBright, yellowBright, blueBright, redBright, underline, bgYellow, black } = require("picocolors");

const methods = ["get", "post", "put", "delete", "patch"];
/**
 * @import { RouteOptions } from "../../src/api/middlewares/Route";
 */
/**
 * Discovered routes
 * @type {Map<string, RouteOptions>}
 */
const routes = new Map();
let currentFile = "";
let currentPath = "";
let currentRoutePrefix = "";
const routeOptions = new WeakMap();

function colorizeMethod(method) {
    switch (method.toLowerCase()) {
        case "get":
            return greenBright(method.toUpperCase());
        case "post":
            return yellowBright(method.toUpperCase());
        case "put":
            return blueBright(method.toUpperCase());
        case "delete":
            return redBright(method.toUpperCase());
        case "patch":
            return yellowBright(method.toUpperCase());
        default:
            return method.toUpperCase();
    }
}

function formatPath(path) {
    return path.replace(/:(\w+)/g, underline(":$1")).replace(/#(\w+)/g, underline("#$1"));
}

/**
 * @param {string} file
 * @param {string} apiMethod
 * @param {string} apiPathPrefix
 * @param {string} apiPath
 * @param args
 */
function proxy(file, apiMethod, apiPathPrefix, apiPath, ...args) {
    // Express supports nested middleware arrays. Keep metadata off function
    // prototypes so bound/arrow functions and transpilation do not affect it.
    const middleware = args.flat(Infinity).find((handler) => typeof handler === "function" && routeOptions.has(handler));
    const opts = middleware && routeOptions.get(middleware);
    if (!opts) {
        console.error(
            `  \x1b[5m${bgYellow(black("WARN"))}\x1b[25m ${file.replace(path.resolve(__dirname, "..", "..", "dist"), "/src")} has route without route() description middleware: ${colorizeMethod(apiMethod)} ${formatPath(apiPath)}`,
        );
        routes.set(currentRoutePrefix + apiPathPrefix + apiPath + "|" + apiMethod, null);
        return;
    }

    console.log(`${colorizeMethod(apiMethod).padStart("DELETE".length + 10)} ${formatPath(apiPathPrefix + apiPath)}`);
    routes.set(currentRoutePrefix + apiPathPrefix + apiPath + "|" + apiMethod, {
        ...opts,
        file: file.replace("/dist/", "/src/").replace(/\.js$/, ".ts"),
    });
}

express.Router = () => {
    const file = currentFile;
    const prefix = currentPath;
    const router = { use: () => router };
    for (const method of methods) {
        router[method] = (...args) => {
            proxy(file, method, prefix, ...args);
            return router;
        };
    }
    return router;
};

RouteUtility.route = (opts) => {
    const func = function () {
        return opts;
    };
    routeOptions.set(func, opts);
    return func;
};

async function getPrefixedRouteDescriptions(routePrefix, root) {
    currentRoutePrefix = routePrefix;
    await traverseDirectory({ dirname: root, recursive: true }, (file) => {
        currentFile = file;

        currentPath = file.replace(root.slice(0, -1), "");
        currentPath = currentPath.split(".").slice(0, -1).join("."); // truncate .js/.ts file extension of path
        currentPath = currentPath.replaceAll("#", ":").replaceAll("\\", "/"); // replace # with : for path parameters and windows paths with slashes
        currentPath = currentPath.replaceAll(/%[A-Za-z0-9]{2}/g, (match) => decodeURIComponent(match)); // special case to handle .well-known for example
        if (currentPath.endsWith("/index")) currentPath = currentPath.slice(0, "/index".length * -1); // delete index from path

        // Permit repeated generation in one process without losing cached routes.
        delete require.cache[require.resolve(file)];
        try {
            require(file);
        } catch (error) {
            throw new Error(`Failed to discover routes in ${file}`, { cause: error });
        }
    });
}

module.exports = async function getRouteDescriptions() {
    routes.clear();
    await getPrefixedRouteDescriptions("/api", path.join(__dirname, "..", "..", "dist", "api", "routes", "/"));
    await getPrefixedRouteDescriptions("", path.join(__dirname, "..", "..", "dist", "api", "routes_toplevel", "/"));

    return new Map(routes);
};
