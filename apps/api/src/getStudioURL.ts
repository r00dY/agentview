export function getStudioURL() {
    if (!process.env.AGENTVIEW_STUDIO_URL) {
        throw new Error('AGENTVIEW_STUDIO_URL is not set');
    }
    return process.env.AGENTVIEW_STUDIO_URL;
}