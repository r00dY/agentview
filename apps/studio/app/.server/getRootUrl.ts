export function getRootUrl() {
    if (!process.env.ROOT_URL) {
        throw new Error('ROOT_URL is not set');
    }
    return process.env.ROOT_URL;
}