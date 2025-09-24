import type { BaseError } from "./errors";
type APISuccessResponse<T> = Response & {
    ok: true;
    data: T;
};
type APIErrorResponse = Response & {
    ok: false;
    error: BaseError;
};
type APIResponse<T> = APISuccessResponse<T> | APIErrorResponse;
type APIOptions = {
    method?: RequestInit['method'];
    body?: any;
};
export declare function apiFetch<T = any>(url: string, options?: APIOptions): Promise<APIResponse<T>>;
export {};
//# sourceMappingURL=apiFetch.d.ts.map