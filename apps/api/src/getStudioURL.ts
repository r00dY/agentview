export function getStudioURL() {
    if (!process.env.STUDIO_URL) {
        throw new Error('STUDIO_URL is not set');
    }
    return process.env.STUDIO_URL;
}