export function getEnv() {
    if (!import.meta.env.VITE_AGENTVIEW_ENV) {
        throw new Error('VITE_AGENTVIEW_ENV must be either "dev" or "prod"');
    }

    return import.meta.env.VITE_AGENTVIEW_ENV;
}