import Ajv, { SchemaObject } from "ajv";
import type { AnyValidateFunction } from "ajv/dist/core";
import addFormats from "ajv-formats";
import fs from "node:fs";
import path from "node:path";

const SchemaPath = path.join(__dirname, "..", "..", "assets", "schemas.json");

// const schemas2 = {...schemas, definitions: {...schemas, }};
// console.log(schemas);
// for (const schemaName in schemas) {
// 	const schema = schemas[schemaName];
// 	if ("x-sb-defs" in schema) {
// 		console.log("[Validator] Adding definitions for schema", schemaName, ":", schema["x-sb-defs"]);
// 		for (const defKey of schema["x-sb-defs"]) {
// 			console.log(" - ", defKey, typeof schemas[defKey] === "object");
// 			schema.definitions = schema.definitions || {};
// 			if (schemas[defKey]) schema.definitions[defKey] = schemas[defKey];
// 			else console.warn("[Validator] Definition", defKey, "not found for schema", schemaName);
// 		}
// 	}
// }

let compiled: Ajv | undefined;

export function getAjv() {
    if (compiled) return compiled;
    const schemas = JSON.parse(fs.readFileSync(SchemaPath, { encoding: "utf8" }).replaceAll("#/definitions/", ""));
    console.log("[Validation] Initializing Ajv with", Object.entries(schemas).length, "schemas...");
    const ajv = new Ajv({
        allErrors: true,
        parseDate: true,
        allowDate: true,
        // schemas: schemas,
        coerceTypes: true,
        messages: true,
        strict: true,
        strictRequired: true,
        allowUnionTypes: true,
    });

    addFormats(ajv);
    Object.entries(schemas).forEach((s) => ajv.addSchema(s[1] as SchemaObject, s[0]));

    compiled = ajv;
    return ajv;
}

export function usePrecompiledSchemas(validators: Record<string, AnyValidateFunction>) {
    const precompiled = {
        errors: null as AnyValidateFunction["errors"],
        getSchema: (name: string) => validators[name],
        validate(name: string, data: unknown) {
            const validate = validators[name];
            if (!validate) throw new Error(`no schema with key or ref "${name}"`);
            const valid = validate(data);
            precompiled.errors = validate.errors;
            return valid;
        },
    };
    compiled = precompiled as unknown as Ajv;
}

export function validateSchema<G extends object>(schema: string, data: G): G {
    const ajv = getAjv();
    const valid = ajv.validate(schema, data);
    if (!valid) {
        console.log("[Validator] Validation error in ", schema);
        throw ajv.errors;
    }
    return data;
}
