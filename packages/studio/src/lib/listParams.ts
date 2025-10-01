import { allowedSessionLists } from "./shared/apiTypes";
import { config } from "~/config";

export function getListParamsAndCheckForRedirect(request: Request) {
    const url = new URL(request.url);
    let list = url.searchParams.get('list')

    let needsRedirect = false;

    if (!list) {
        list = "real";
        needsRedirect = true;
    }

    if (!allowedSessionLists.includes(list)) {
        throw new Error(`[session list] invalid list: ${list}. Allowed lists are: ${allowedSessionLists.join(", ")}`);
    }

    let agent = url.searchParams.get('agent');

    if (!agent) {
        const defaultAgent = config.agents?.[0];
        if (!defaultAgent) {
            throw new Error(`[session list] no agents found`);
        }
        agent = defaultAgent.name;
        needsRedirect = true;
    }

    const page = url.searchParams.get('page') ?? undefined
    const limit = url.searchParams.get('limit') ?? undefined

    return {
        listParams: { list, agent, page, limit },
        needsRedirect
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