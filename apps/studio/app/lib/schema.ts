import { apiFetch } from "./apiFetch";
import { serializeBaseConfig } from "./baseConfigHelpers";
import { getBaseConfig } from "./baseConfigHelpers";
import { equalJSON } from "./equalJSON";
import { config } from "../../agentview.config";


export async function getSchema() {
    const response = await apiFetch(`/api/dev/schemas/current`);

    if (!response.ok) {
        throw response.error;
    }

    return response.data;
}

export async function updateSchema() {
    const response = await apiFetch(`/api/dev/schemas`, {
        method: "POST",
        body: {
            schema: serializeBaseConfig(getBaseConfig(config))
        }
    });

    if (!response.ok) {
        throw response.error;
    }

    return response.data;
}

export async function createOrUpdateSchema() {
    const remoteSchema = await getSchema();

    const remoteConfig = remoteSchema?.schema ?? null;
    const currentConfig = serializeBaseConfig(getBaseConfig(config));

    if (!equalJSON(remoteConfig, currentConfig)) {
        console.log('Schema change detected! Updating schema...')
        return await updateSchema();
    }

    return remoteSchema;
}