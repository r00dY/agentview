if (!process.env.POSTGRES_USER || !process.env.POSTGRES_PASSWORD || !process.env.POSTGRES_DB) {
    throw new Error('POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB must be set');
}

export const databaseURL = `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@postgres-db:5432/${process.env.POSTGRES_DB}`