import type { Environment, EnvironmentCreate } from "./apiTypes.js";
import type { InternalConfig } from "./baseConfigTypes.js";
import { serializeConfig } from "./baseConfigUtils.js";
import type { AgentViewBase } from "./client.js";

export const configDefaults: {
    __internal?: InternalConfig
} = { __internal: undefined }

export async function updateEnvironment(client: AgentViewBase, body: EnvironmentCreate): Promise<Environment> {
    const payload: Record<string, any> = { ...body };

    if (body.config !== undefined) {
        let config = body.config;

        if (configDefaults.__internal) {
            config = {
                ...config,
                __internal: {
                    ...configDefaults.__internal,
                    ...(config.__internal ?? {}),
                }
            }
        }

        payload.config = serializeConfig(config);
    }

    return await client._request<Environment>('PATCH', `/api/environment`, payload)
}