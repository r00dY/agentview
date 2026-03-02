import { spaceAllowedValues, type Space } from "agentview/apiTypes";
import { config } from "../config";


export function getListParamsAndCheckForRedirect(request: Request) {
    const url = new URL(request.url);

    let spaceParam = url.searchParams.get('space')
    let space: Space;
    let needsRedirect = false;

    if (!spaceParam) {
        spaceParam = "production";
        needsRedirect = true;
    }
    if (spaceParam === "production" || !spaceParam) {
        space = "production";
    }
    else if (spaceParam === "shared-playground") {
        space = "shared-playground";
    }
    else if (spaceParam === "playground") {
        space = "playground";
    }
    else {
        throw new Error(`[session list] invalid space: ${spaceParam}. Allowed spaces are: ${spaceAllowedValues.join(", ")}`);
    }

    const page = url.searchParams.get('page') ?? undefined
    const limit = url.searchParams.get('limit') ?? undefined

    const listParams = { space, page, limit };

    return {
        listParams,
        redirectUrl: needsRedirect ? applyParamsToUrl(url, listParams) : undefined
    }
}

export function getListParams(request: Request) {
    return getListParamsAndCheckForRedirect(request).listParams;
}

export function toQueryParams(obj: Record<string, any>) {
    const definedValues: Record<string, any> = {}
    for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
            definedValues[key] = value
        }
    }

    return new URLSearchParams(definedValues).toString();
}

export function applyParamsToUrl(url: URL, params: Record<string, any>) {
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined) {
            url.searchParams.delete(key);
        }
        else {
            url.searchParams.set(key, value)
        }
    }
    return url;
}