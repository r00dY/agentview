import { apiFetch } from "./apiFetch";
import { serializeBaseConfig } from "./baseConfigHelpers";
import { getBaseConfig } from "./baseConfigHelpers";
import { equalJSON } from "./equalJSON";
import { config } from "../../agentview.config";


export async function getRemoteConfig() {
    const response = await apiFetch(`/api/dev/configs/current`);

    if (!response.ok) {
        throw response.error;
    }

    return response.data;
}

export async function updateRemoteConfig() {
    const response = await apiFetch(`/api/dev/configs`, {
        method: "POST",
        body: {
            config: serializeBaseConfig(getBaseConfig(config))
        }
    });

    if (!response.ok) {
        throw response.error;
    }

    return response.data;
}

export async function createOrUpdateSchema() {
    const remoteConfigRow = await getRemoteConfig();

    const remoteConfig = remoteConfigRow?.config ?? null;
    const currentConfig = serializeBaseConfig(getBaseConfig(config));

    // console.log('base config', getBaseConfig(config).threads[0].metadata[0])
    // console.log('serialized', currentConfig.threads[0].metadata[0])

    if (!equalJSON(remoteConfig, currentConfig)) {
        console.log('Config change detected! Updating config...')
        return await updateRemoteConfig();
    }

    return remoteConfigRow;
}