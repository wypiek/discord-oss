import { ErrorObject } from "ajv";

export interface FieldErrorResponse {
    code: number;
    message: string;
    errors: ErrorList;
}

export type ErrorList = Record<string, ObjectErrorContent>;
export type ErrorContent = { code: string; message: string };
export type ObjectErrorContent = { _errors: ErrorContent[] };

export function makeObjectErrorContent(code: string, message: string): ObjectErrorContent {
    return { _errors: [{ code, message }] };
}

export function FieldErrors(fields: Record<string, { code?: string; message: string }>, errors?: ErrorObject[]) {
    const errorObj: ErrorList = {};
    for (const [key, { message, code }] of Object.entries(fields)) {
        errorObj[key] = {
            _errors: [
                {
                    message,
                    code: code || "BASE_TYPE_INVALID",
                },
            ],
        };
    }

    return new FieldError(50035, "Invalid Form Body", errorObj, errors);
}

// TODO: implement Image data type: Data URI scheme that supports JPG, GIF, and PNG formats. An example Data URI format is: data:image/jpeg;base64,BASE64_ENCODED_JPEG_IMAGE_DATA
// Ensure you use the proper content type (image/jpeg, image/png, image/gif) that matches the image data being provided.

export class FieldError extends Error {
    constructor(
        public code: string | number,
        public message: string,
        public errors?: ErrorList,
        public _ajvErrors?: ErrorObject[],
    ) {
        super(message);
    }
}
