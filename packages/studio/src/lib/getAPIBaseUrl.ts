export function getAPIBaseUrl() {
    const apiBaseUrl = import.meta.env.VITE_AGENTVIEW_API_BASE_URL;
    if (!apiBaseUrl) {
        throw new Error('VITE_AGENTVIEW_API_BASE_URL is not set');
    }
    return apiBaseUrl;
}