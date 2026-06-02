import { spaceAllowedValues, type Space } from "agentview/apiTypes";
import { config } from "../config";


export function getListParamsAndCheckForRedirect(request: Request) {
    const url = new URL(request.url);

    const spaceParam = url.searchParams.get('space')
    const sharedParam = url.searchParams.get('shared')

    let space: Space | undefined;
    // let shared: boolean | undefined;
    let needsRedirect = false;

    // if (sharedParam === "true") {
    //     shared = true;
    // } else if (sharedParam === "false") {
    //     shared = false;
    // }

    // if (!spaceParam) {
    //     spaceParam = "production";
    //     needsRedirect = true;
    // }

    if (!spaceParam) {
        space = "production";
        needsRedirect = true;
    }
    if (spaceParam === "production") {
        space = "production";
    } else if (spaceParam === "playground") {
        space = "playground";
    } else if (spaceParam) {
        throw new Error(`[session list] invalid space: ${spaceParam}. Allowed spaces are: ${spaceAllowedValues.join(", ")}`);
    }

    const userId = url.searchParams.get('userId') ?? undefined;
    const page = url.searchParams.get('page') ?? undefined
    const limit = url.searchParams.get('limit') ?? undefined
    const shared = url.searchParams.get('shared') ?? undefined
    const ownerId = url.searchParams.get('ownerId') ?? undefined

    const listParams = { space, userId, page, limit, shared, ownerId };

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
