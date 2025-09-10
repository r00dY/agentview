export function getDatabaseURL() {
    if (!process.env.DATABASE_URL)  {
        throw new Error('DATABASE_URL must be set');
    }

    return process.env.DATABASE_URL;
}
