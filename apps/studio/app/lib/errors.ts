import type { APIError } from "better-auth";

export type BaseError = {
    message: string;
    code?: string;
    fieldErrors?: Record<string, string>; // for form errors
    [key: string]: any;
}

export type ActionSuccessResponse<T = any> = {
    ok: true;
    data: T;
}

export type ActionErrorResponse<E extends BaseError = BaseError> = {
    ok: false,
    error: E;
}

export type ActionResponse<T = any, E extends BaseError = BaseError> = ActionSuccessResponse<T> | ActionErrorResponse<E>;


type BetterAuthError = {
    code?: string | undefined;
    message?: string | undefined;
    status: number;
    statusText: string;
}

export function betterAuthErrorToBaseError(error: BetterAuthError): BaseError {
    return {
        ...error,
        message: error.message ?? "Undefined error from better-auth",
    }
}