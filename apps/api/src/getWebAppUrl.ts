export function getWebAppUrl() {
    if (!process.env.AGENTVIEW_WEBAPP_URL) {
        throw new Error('AGENTVIEW_WEBAPP_URL is not set');
    }
    return process.env.AGENTVIEW_WEBAPP_URL;
}