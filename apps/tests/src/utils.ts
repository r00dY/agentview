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
    const orgSlug = "test-" + Math.random().toString(36).slice(2);
    console.log("Seeding users for org: ", orgSlug);

    const result = await seedUsers(orgSlug);

    const localStandardClient = createStandardClient({
        apiKey: result.apiKeySecret.key,
        env: "dev:" + result.admin.user.email
    })

    const localClient = createClient({
        apiKey: result.apiKeySecret.key,
        env: "dev:" + result.admin.user.email
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

    // organization = result.organization;
    // adminUser = result.adminUser;

    // apiKeySecret = result.apiKeySecret.key;
    // apiKeyPublic = result.apiKeyPublic.key;

    // av = createStandardClient({
    //   apiKey: result.apiKeySecret.key,
    //   env: "dev:"+adminUser.email
    // })

    // avLocal = av;

    // avAISDKLocal = createClient({
    //     apiKey: result.apiKeySecret.key,
    //     env: "dev:" + adminUser.email
    // })

    // avProd = createStandardClient({
    //     apiKey: result.apiKeySecret.key,
    //     env: "production"
    // })

    // avAISDKProd = createClient({
    //     apiKey: result.apiKeySecret.key,
    //     env: "production"
    // })

    // initUser1 = await av.createUser({ externalId: EXTERNAL_ID_1 })
    // initUser2 = await av.createUser({ externalId: EXTERNAL_ID_2 })
    // initProdUser = await avProd.createUser({ externalId: EXTERNAL_PROD_ID_1, space: "production" })

    // localUser1 = initUser1;
    // localUser2 = initUser2;
    // prodUser1 = initProdUser;
}

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
