import { expect } from "vitest";
import { seedUsers } from "./seedUsers";
import { configDefaults, createStandardClient } from "agentview/clientStandard";
import { createClient } from "agentview";


// globally disable summaries for all tests
configDefaults.__internal = {
    disableSummaries: true,
}

export function expectToFail(promise: Promise<any>, statusCode: number) {
    return expect(promise).rejects.toThrowError(expect.objectContaining({
        // source: "agentview",
        statusCode,
        message: expect.any(String),
    }))
}

export async function setupTestOrg() {
    const orgSlug = "x-" + Math.random().toString(36).slice(2);
    console.log("Seeding users for org: ", orgSlug);

    const result = await seedUsers(orgSlug);

    const localStandardClient = createStandardClient({
        apiKey: result.apiKeySecret.key,
        env: "local-admin"
    })

    const localClient = createClient({
        apiKey: result.apiKeySecret.key,
        env: "local-admin"
    })

    const prodStandardClient = createStandardClient({
        apiKey: result.apiKeySecret.key,
        env: "production"
    })

    const prodClient = createClient({
        apiKey: result.apiKeySecret.key,
        env: "production"
    })

    return {
        ...result,
        admin: {
            ...result.admin,
            localStandardClient,
            localClient,
        },
        prodClient,
        prodStandardClient,
    }
}

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
