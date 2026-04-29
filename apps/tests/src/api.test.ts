import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { type User } from 'agentview';
import type { SessionStreamEvent, StandardRun, StandardSession } from 'agentview/apiTypes';
import { createStandardClient, type StandardAgentViewClient } from 'agentview/clientStandard';
import { updateEnvironment } from 'agentview/updateEnvironment';


import { z } from 'zod';
import { seedUsers } from './seedUsers';

import { setupTestOrg } from './utils';

describe('API', () => {
  let initUser1: User
  let initUser1Token: string

  let initUser2: User
  let initUser2Token: string

  let initProdUser: User
  let initProdUserToken: string

  const EXTERNAL_ID_1 = 'external-id-1'
  const EXTERNAL_ID_2 = 'external-id-2'
  const EXTERNAL_PROD_ID_1 = 'external-prod-id-1'

  let org: Awaited<ReturnType<typeof setupTestOrg>>;

  let av: StandardAgentViewClient;

  beforeAll(async () => {
    org = await setupTestOrg();

    av = org.admin.localStandardClient;
    
    const initUser1Result = await org.admin.localClient.users.create({ externalId: EXTERNAL_ID_1 })
    initUser1 = initUser1Result.user
    initUser1Token = initUser1Result.token

    const initUser2Result = await org.admin.localClient.users.create({ externalId: EXTERNAL_ID_2 })
    initUser2 = initUser2Result.user
    initUser2Token = initUser2Result.token
    
    const initProdUserResult = await org.prodClient.users.create({ externalId: EXTERNAL_PROD_ID_1, space: "production" })
    initProdUser = initProdUserResult.user
    initProdUserToken = initProdUserResult.token

    expect(initUser1).toBeDefined()
    expect(initUser1.externalId).toBe(EXTERNAL_ID_1)
    expect(initUser1.ownerId).toBeDefined()

    expect(initUser2).toBeDefined()
    expect(initUser2.externalId).toBe(EXTERNAL_ID_2)
    expect(initUser1.ownerId).toBeDefined()

    expect(initProdUser).toBeDefined()
    expect(initProdUser.externalId).toBe(EXTERNAL_PROD_ID_1) // external id the same as initUSer1, but in prod
    expect(initProdUser.ownerId).toBeNull()
  })

  async function expectToFail(promise: Promise<any>, statusCode: number) {
    return expect(promise).rejects.toThrowError(expect.objectContaining({
      statusCode,
      message: expect.any(String),
    }))
  }

  const updateConfig = async (options: { strictMatching?: boolean, runMetadata?: Record<string, z.ZodType>, allowUnknownMetadata?: boolean, validateOutput?: boolean, prod?: boolean, itemScores?: { name: string, schema: z.ZodType }[], runScores?: { name: string, schema: z.ZodType }[], version?: string, adapter?: 'agentview' | 'ai-sdk' } = {}) => {

    let inputSchema = z.looseObject({ type: z.literal("message"), role: z.literal("user"), content: z.string() })
    let stepSchema = z.looseObject({ type: z.literal("reasoning"), content: z.string() })
    let functionCallSchema = z.looseObject({ type: z.literal("function_call"), name: z.string(), callId: z.string().meta({ callId: true }) })
    let functionResultSchema = z.looseObject({ type: z.literal("function_call_result"), callId: z.string().meta({ callId: true }) })

    let outputSchema = z.looseObject({ type: z.literal("message"), role: z.literal("assistant"), content: z.string() })

    if (options.strictMatching) {
      inputSchema = inputSchema.strict();
      stepSchema = stepSchema.strict();
      outputSchema = outputSchema.strict();
    }

    const config = {
      agents: [
        {
          name: "test",
          version: options.version ?? "1.0.0",
          ...(options.adapter && { adapter: options.adapter }),
          runs: [
            {
              input: { schema: inputSchema },
              output: [{ schema: stepSchema }, { schema: functionCallSchema, callResult: { schema: functionResultSchema } }, { schema: outputSchema, scores: options.itemScores }],
              scores: options.runScores,
              metadata: options.runMetadata,
              validateOutput: options.validateOutput,
              allowUnknownMetadata: options.allowUnknownMetadata,
            }
          ]
        }
      ],
      channels: [
        { type: 'api' as const, name: "test", agent: "test" }
      ]
    }

    if (options.prod) {
      await updateEnvironment(org.prodStandardClient, { config })
    }
    else {
      await updateEnvironment(av, { config })
    }
  }

  const baseInput = { type: "message", role: "user", content: "Hello" }
  const baseOutput = { type: "message", role: "assistant", content: "Hi there" }
  const baseStep = { type: "reasoning", content: "Thinking...", id: "base-step-1" }

  const fun1Call = (id?: string) => ({ type: "function_call", name: "function1", ...(id ? { callId: id } : {}) })
  const fun2Call = (id?: string) => ({ type: "function_call", name: "function2", ...(id ? { callId: id } : {}) })

  const funResult = (id?: string) => ({ type: "function_call_result", ...(id ? { callId: id } : {}) })

  const baseInputExt = { type: "message", role: "user", content: "Hello", __extraField: "extra" }
  const baseOutputExt = { type: "message", role: "assistant", content: "Hi there", __extraField: "extra" }
  const baseStepExt = { type: "reasoning", content: "Thinking...", __extraField: "extra" }

  const wrongInput = { type: "message", role: "user", content: 100 }
  const wrongStep = { type: "reasoning", content: 100 }
  const wrongOutput = { type: "message", role: "assistant", content: 100 }


  async function createSession() {
    return await av.createSession({ agent: "test", userId: initUser1.id })
  }

  describe("users", () => {
    test("creating another user with the same external id should fail", async () => {
      await expect(av.users.create({ externalId: EXTERNAL_ID_1 })).rejects.toThrowError(expect.objectContaining({
        statusCode: 422,
        message: expect.any(String),
      }))
    })

    // TODO: Uncomment this when update user is implemented
    // test("update works", async () => {
    //   const EXTERNAL_ID = Math.random().toString(36).slice(2);
    //   const NEW_EXTERNAL_ID = EXTERNAL_ID + '1';

    //   const user = await av.users.create({ externalId: EXTERNAL_ID, isShared: false })
    //   let updatedUser = await av.updateUser({ id: user.id, externalId: NEW_EXTERNAL_ID, isShared: true })
    //   expect(updatedUser).toBeDefined()
    //   expect(updatedUser.externalId).toBe(NEW_EXTERNAL_ID)
    //   expect(updatedUser.isShared).toBe(true)

    //   updatedUser = await av.users.get({ id: user.id })
    //   expect(updatedUser).toBeDefined()
    //   expect(updatedUser.externalId).toBe(NEW_EXTERNAL_ID)
    //   expect(updatedUser.isShared).toBe(true)
    // })

    describe("get by id", () => {

      test("existing ids", async () => {
        const user1 = await av.users.get(initUser1.id)
        expect(user1).toBeDefined()
        expect(user1.externalId).toBe(EXTERNAL_ID_1)

        const user2 = await av.users.get(initUser2.id)
        expect(user2).toBeDefined()
        expect(user2.externalId).toBe(EXTERNAL_ID_2)
      })

      test("not found", async () => {
        await expect(av.users.get('xxx')).rejects.toThrowError(expect.objectContaining({
          statusCode: 404,
          message: expect.any(String),
        }))
      })

      test("succeeds when scoped with own token with .me()", async () => {
        const user1 = await av.asUser(initUser1).users.me()
        expect(user1).toBeDefined()
        expect(user1.externalId).toBe(EXTERNAL_ID_1)
      })

      test("getUser by id fails when scoped with other user's token", async () => {
        await expect(av.asUser(initUser1).users.get(initUser1.id)).rejects.toThrowError(expect.objectContaining({
          statusCode: 401,
          message: expect.any(String),
        }))
      })

      test("getUser by id fails when scoped with other user's token", async () => {
        await expect(av.asUser(initUser1).users.get(initUser2.id)).rejects.toThrowError(expect.objectContaining({
          statusCode: 401,
          message: expect.any(String),
        }))
      })
    })

    describe("get by external id", () => {
      test("existing external ids", async () => {
        const user1 = await av.users.getByExternalId(EXTERNAL_ID_1)
        expect(user1).toBeDefined()
        expect(user1.externalId).toBe(EXTERNAL_ID_1)
      })

      test("not found", async () => {
        await expect(av.users.getByExternalId('unknown_external_id')).rejects.toThrowError(expect.objectContaining({
          statusCode: 404,
          message: expect.any(String),
        }))
      })

      test("fails when scoped with own user's token, but by calling getUser by external id", async () => {

        await expect(av.asUser(initUser1).users.getByExternalId(EXTERNAL_ID_1)).rejects.toThrowError(expect.objectContaining({
          statusCode: 401,
          message: expect.any(String),
        }))

        // const user1 = await av.as(initUser1).users.get({ externalId: EXTERNAL_ID_1 })
        // expect(user1).toBeDefined()
        // expect(user1.externalId).toBe(EXTERNAL_ID_1)
      })

      test("fails when scoped with another user's token", async () => {
        await expect(av.asUser(initUser2).users.getByExternalId(EXTERNAL_ID_1)).rejects.toThrowError(expect.objectContaining({
          statusCode: 401,
          message: expect.any(String),
        }))
      })
    })

    describe("environment-related behaviour", () => {
      test("[local env] default space is user's playground", async () => {
        const { user } = await av.users.create()
        expect(user.space).toBe("playground")
        expect(user.ownerId).toBe(org.admin.user.id)
      })

      test("[local env] production space is blocked", async () => {
        await expect(av.users.create({ space: "production" })).rejects.toThrowError(expect.objectContaining({
          statusCode: 401,
          message: expect.any(String),
        }))
      })

      test("[prod env] default space for new user is production and ownerId is null", async () => {
        const { user } = await org.prodStandardClient.users.create()
        expect(user.space).toBe("production")
        expect(user.ownerId).toBeNull()
      })

      // test("[prod api-key] playground or shared-playground are not allowed with production api-key (you must be logged in as member to do it)", async () => {
      //   await expect(org.prodStandardClient.users.create({ space: "playground" })).rejects.toThrowError(expect.objectContaining({
      //     statusCode: 401,
      //     message: expect.any(String),
      //   }))

      //   await expect(org.prodStandardClient.users.create({ space: "shared-playground" })).rejects.toThrowError(expect.objectContaining({
      //     statusCode: 401,
      //     message: expect.any(String),
      //   }))
      // })


      // test("[prod api-key] playground is possible only with explicit ", async () => {
      //   const user = await av.users.create({ space: "shared-playground" })
      //   expect(user.space).toBe("shared-playground")
      //   expect(user.createdBy).toBeNull()
      // })

      // test("[dev api-key] production space is blocked", async () => {
      //   await expect(av.users.create({ space: "production" })).rejects.toThrowError(expect.objectContaining({
      //     statusCode: 401,
      //     message: expect.any(String),
      //   }))
      // })
    })

    describe("get me", () => {
      test("works", async () => {
        const user1 = await av.asUser(initUser1).users.me()
        expect(user1).toBeDefined()
        expect(user1.externalId).toBe(EXTERNAL_ID_1)

        const user2 = await av.asUser(initUser2).users.me()
        expect(user2).toBeDefined()
        expect(user2.externalId).toBe(EXTERNAL_ID_2)
      })

      test("fails for bad token", async () => {
        await expect(av.asUser({ token: 'xxx' }).users.me()).rejects.toThrowError(expect.objectContaining({
          statusCode: 401,
          message: expect.any(String),
        }))
      })
    })

    describe("PUBLIC API", () => {

      describe("get me", () => {

        test("works for existing users", async () => {

          const avPublic = createStandardClient({
            apiKey: org.apiKeyPublic.key,
          })
          const avPublicAsUser1 = avPublic.asUser({ token: initUser1Token })
          const user1 = await avPublicAsUser1.users.me()

          expect(user1).toBeDefined()
          expect(user1.externalId).toBe(EXTERNAL_ID_1)

          const avPublicAsUser2 = avPublic.asUser({ token: initUser2Token })
          const user2 = await avPublicAsUser2.users.me()
          expect(user2).toBeDefined()
          expect(user2.externalId).toBe(EXTERNAL_ID_2)
        })

        test("fails for unknown key", async () => {
          const avPublic = createStandardClient({
            apiKey: org.apiKeyPublic.key,
          })
          const avPublicAsUser = avPublic.asUser({ token: "xxx" })

          await expect(avPublicAsUser.users.me()).rejects.toThrowError(expect.objectContaining({
            statusCode: 401,
            message: expect.any(String),
          }))
        })

        test("fails for scoping as id", async () => {
          const avPublic = createStandardClient({
            apiKey: org.apiKeyPublic.key,
          })
          const avPublicAsUser = avPublic.asUser({ id: initUser1.id })

          await expect(avPublicAsUser.users.me()).rejects.toThrowError(expect.objectContaining({
            statusCode: 401,
            message: expect.any(String),
          }))
        })
      })

      describe("get session by id", () => {
        test("works for own session", async () => {
          await updateEnvironment(av, { config: { agents: [{ name: "test", version: "1.0.0" }], channels: [{ type: 'api', name: "test", agent: "test" }] } })
          const session = await av.createSession({ agent: "test", userId: initUser1.id})

          const avPublic = createStandardClient({
            apiKey: org.apiKeyPublic.key,
          })

          const avPublicAsUser1 = avPublic.asUser({ token: initUser1Token })

          const fetchedSession = await avPublicAsUser1.getSession({ id: session.id })as StandardSession;
          expect(fetchedSession).toMatchObject(session)
        })

        test("fails for someone else's session", async () => {
          await updateEnvironment(av, { config: { agents: [{ name: "test", version: "1.0.0" }], channels: [{ type: 'api', name: "test", agent: "test" }] } })
          const session = await av.createSession({ agent: "test", userId: initUser1.id})

          const avPublic = createStandardClient({
            apiKey: org.apiKeyPublic.key,
          })

          const avPublicAsUser2 = avPublic.asUser({ token: initUser2Token })

          await expect(avPublicAsUser2.getSession({ id: session.id })).rejects.toThrowError(expect.objectContaining({
            statusCode: 401,
            message: expect.any(String),
          }))
        })
      })
    })


  })



  describe("environments", () => {

    test("works", async () => {
      const CONFIG = { agents: [{ name: "test", version: "1.0.0" }], __internal: { disableSummaries: true } };

      let environment = await updateEnvironment(av, { config: CONFIG })
      expect(environment.config).toEqual(CONFIG);

      environment = await av.environments.getActive();
      expect(environment.config).toEqual(CONFIG);

      const CONFIG_2 = { agents: [{ name: "test2", version: "1.0.0" }], __internal: { disableSummaries: true } };

      environment = await updateEnvironment(av, { config: CONFIG_2 })
      expect(environment.config).toEqual(CONFIG_2);

      environment = await av.environments.getActive();
      expect(environment.config).toEqual(CONFIG_2);
    })

    test("non-config fields are stripped", async () => {
      const CONFIG = { agents: [], __internal: { disableSummaries: true } };
      const CONFIG_WITH_ANIMAL = { ...CONFIG, animal: "dog" };

      let environment = await updateEnvironment(av, { config: CONFIG_WITH_ANIMAL })
      expect(environment.config).toEqual(CONFIG);

      environment = await av.environments.getActive();
      expect(environment.config).toEqual(CONFIG);
    })

    test("invalid config throws", async () => {
      await expect(updateEnvironment(av, { config: { agents: 100 } })).rejects.toThrowError(expect.objectContaining({
        statusCode: 422,
        message: expect.any(String),
      }))
    })

    test("each developer has their own dev env+config", async () => {
    // const authClient = createTestAuthClient();

      // // Sign in as Bob and create his API key
      // await authClient.signIn.email({ email: `bob@${orgSlug}.com`, password: "blablabla" });
      // const bobApiKey = await authClient.apiKey.create({
      //   name: "bob-key",
      //   prefix: 'dev_',
      //   metadata: { organizationId: organization.id, env: 'dev' }
      // });
      // await authClient.signOut();

      // // Sign in as Alice and create her API key
      // await authClient.signIn.email({ email: `alice@${orgSlug}.com`, password: "blablabla" });
      // const aliceApiKey = await authClient.apiKey.create({
      //   name: "alice-key",
      //   prefix: 'dev_',
      //   metadata: { organizationId: organization.id, env: 'dev' }
      // });
      // await authClient.signOut();

      const avBob = createStandardClient({ apiKey: org.apiKeySecret.key, env: `local:bob@${org.organization.slug}.com` });
      const avAlice = createStandardClient({ apiKey: org.apiKeySecret.key, env: `local:alice@${org.organization.slug}.com` });

      // Bob uploads his config
      const BOB_CONFIG = { agents: [{ name: "bob-agent", version: "1.0.0" }], __internal: { disableSummaries: true } };
      await updateEnvironment(avBob, { config: BOB_CONFIG });

      // Alice uploads her config
      const ALICE_CONFIG = { agents: [{ name: "alice-agent", version: "1.0.0" }], __internal: { disableSummaries: true } };
      await updateEnvironment(avAlice, { config: ALICE_CONFIG });

      // Verify each developer sees only their own config
      const bobConfig = await avBob.environments.getActive();
      expect(bobConfig.config).toEqual(BOB_CONFIG);

      const aliceConfig = await avAlice.environments.getActive();
      expect(aliceConfig.config).toEqual(ALICE_CONFIG);

      // Double-check Bob's config wasn't overwritten by Alice's
      const bobConfigAgain = await avBob.environments.getActive();
      expect(bobConfigAgain.config).toEqual(BOB_CONFIG);

      // Test that configs are isolated for real operations (sessions/runs)
      // Bob can create sessions for his channel
      const { user: bobUser } = await avBob.users.create({ externalId: "bob-test-user" });
      const bobSession = await avBob.createSession({ agent: "bob-agent", userId: bobUser.id });
      expect(bobSession.channel).toEqual({ type: 'api', name: 'bob-agent' });

      // Alice can create sessions for her channel
      const { user: aliceUser } = await avAlice.users.create({ externalId: "alice-test-user" });
      const aliceSession = await avAlice.createSession({ agent: "alice-agent", userId: aliceUser.id });
      expect(aliceSession.channel).toEqual({ type: 'api', name: 'alice-agent' });

      // Bob cannot create sessions for Alice's channel (not in his config)
      await expect(avBob.createSession({ agent: "alice-agent", userId: bobUser.id }))
        .rejects.toThrowError(expect.objectContaining({ statusCode: 404 }));

      // Alice cannot create sessions for Bob's channel (not in her config)
      await expect(avAlice.createSession({ agent: "bob-agent", userId: aliceUser.id }))
        .rejects.toThrowError(expect.objectContaining({ statusCode: 404 }));
    })

    test("write operations for sessions or end users with dev api key fail in prod environment", async () => {
      await updateConfig()
      await updateConfig({ prod: true });

      // creating prod user allowed with prod key
      const { user: prodUser } = await org.prodStandardClient.users.create({ space: "production" })
      expect(prodUser).toBeDefined()

      // creating prod session allowed with prod key
      const prodSession = await org.prodStandardClient.createSession({ agent: "test", userId: prodUser.id })
      expect(prodSession).toBeDefined()

      // creating prod user not allowed with dev key
      await expect(av.users.create({ space: "production" })).rejects.toThrowError(expect.objectContaining({
        statusCode: 401,
        message: expect.any(String),
      }))

      // creating prod session not allowed with dev key
      await expect(av.createSession({ agent: "test", userId: prodUser.id })).rejects.toThrowError(expect.objectContaining({
        statusCode: 401,
        message: expect.any(String),
      }))
    })


    test("local env without tunnel → creating run should result in 400 error", async () => {
      await updateConfig()
      await updateConfig({ prod: true });


      const session = await org.admin.localClient.sessions.create({ agent: "test", userId: initUser1.id });
      const promise = org.admin.localClient.sessions.createRun(session.id, { input: { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hello" }] } });

      await expectToFail(promise, 400)
    });

    test("setting tunnelUrl on production env → 400 error", async () => {
      await updateConfig()
      await updateConfig({ prod: true });

      await expect(
        updateEnvironment(org.prodStandardClient, { tunnelUrl: "https://some-proxy-url.com" })
      ).rejects.toThrowError(expect.objectContaining({
        statusCode: 400,
        message: expect.stringContaining("production"),
      }));
    });

    test("incorrect tunnel URL format → 400 error", async () => {
      await updateConfig()

      await expect(
        updateEnvironment(org.admin.localStandardClient, { tunnelUrl: "xxxx" })
      ).rejects.toThrowError(expect.objectContaining({
        statusCode: 422,
      }));

      await expect(
        updateEnvironment(org.admin.localStandardClient, { tunnelUrl: "ftp://some-domain.com/incorrect-tunnel-url" })
      ).rejects.toThrowError(expect.objectContaining({
        statusCode: 422,
      }));
    });


  })

  describe("sessions", async () => {
    test("create for specific user", async () => {
      await updateEnvironment(av, { config: { agents: [{ name: "test", version: "1.0.0" }], channels: [{ type: 'api', name: "test", agent: "test" }] } })

      const session = await av.createSession({ agent: "test", userId: initUser1.id})
      expect(session).toMatchObject({
        metadata: {},
        runs: [],
        user: {
          id: initUser1.id,
          externalId: EXTERNAL_ID_1,
          space: "playground",
          token: initUser1Token,
        }
      })
    })

    // test("create for no user (creates new user)", async () => {
    //   await updateEnvironment(av, { config: { agents: [{ name: "test", version: "1.0.0" }], channels: [{ type: 'api', name: "test", agent: "test" }] } })

    //   const session = await av.createSession({ agent: "test" })
    //   expect(session.userId).toBeDefined()

    //   const fetchedSession = await av.as(session.user).getSession({ id: session.id });
    //   expect(fetchedSession).toMatchObject(session)
    // })

    test("create session for other user with 'as' -> should throw", async () => {
      await updateEnvironment(av, { config: { agents: [{ name: "test", version: "1.0.0" }], channels: [{ type: 'api', name: "test", agent: "test" }] } })

      await expect(av.asUser(initUser1).createSession({ agent: "test", userId: initUser2.id })).rejects.toThrowError(expect.objectContaining({
        statusCode: 401,
        message: expect.any(String),
      }))

    })

    test("create - fails at wrong agent", async () => {
      await updateEnvironment(av, { config: { agents: [{ name: "test", version: "1.0.0" }], channels: [{ type: 'api', name: "test", agent: "test" }] } })

      await expect(av.createSession({ agent: "wrong_channel", userId: initUser1.id })).rejects.toThrowError(expect.objectContaining({
        statusCode: 404,
        message: expect.any(String),
      }))
    })




    test("get by id for existing session", async () => {
      await updateEnvironment(av, { config: { agents: [{ name: "test", version: "1.0.0" }], channels: [{ type: 'api', name: "test", agent: "test" }] } })

      const session = await av.createSession({ agent: "test", userId: initUser1.id})
      const fetchedSession = await av.getSession({ id: session.id })
      expect(fetchedSession).toMatchObject({
        metadata: {},
        runs: [],
        userId: initUser1.id,
      })
    })

    test("get by id - wrong id", async () => {
      await updateEnvironment(av, { config: { agents: [{ name: "test", version: "1.0.0" }], channels: [{ type: 'api', name: "test", agent: "test" }] } })

      await expect(av.getSession({ id: 'xxx' })).rejects.toThrowError(expect.objectContaining({
        statusCode: 404,
        message: expect.any(String),
      }))
    })

    test("history and lastRun are generated correctly as new runs are created", async () => {
      await updateConfig()

      let session = await createSession()
      expect(session.items).toEqual([])
      expect(session.lastRun).toBeUndefined()

      // First run, check 
      let run1 = await av.createManualRun({ sessionId: session.id, items: [baseInput] })
      session = await av.getSession({ id: session.id })
      expect(session.items).toEqual([baseInput])
      expect(session.lastRun?.id).toBe(run1.id)

      run1 = await av.updateManualRun({ id: run1.id, items: [baseOutput], status: "completed" })
      session = await av.getSession({ id: session.id })
      expect(session.items).toEqual([baseInput, baseOutput])
      expect(session.lastRun?.id).toBe(run1.id)

      // // Second run, failed, but items in the history
      // let run2 = await av.createManualRun({ sessionId: session.id, items: [baseInput, baseStep, baseOutput], status: "failed" })
      // session = await av.getSession({ id: session.id })
      // expect(session.items).toEqual([baseInput, baseOutput, baseInput, baseStep, baseOutput])
      // expect(session.lastRun?.id).toBe(run2.id)

      // // Retry, successful
      // let run3 = await av.createManualRun({ sessionId: session.id, items: [baseInput, baseStep, baseOutput], status: "completed" })
      // session = await av.getSession({ id: session.id })
      // expect(session.items).toEqual([baseInput, baseOutput, baseInput, baseStep, baseOutput])
      // expect(session.lastRun?.id).toBe(run3.id)
    })

    test("state works properly", async () => {
      await updateConfig()

      let session = await createSession()
      expect(session.state).toBeNull();

      // First run, check strict matching
      let run1 = await av.createManualRun({ sessionId: session.id, items: [baseInput] })
      session = await av.getSession({ id: session.id })
      expect(session.state).toEqual(null)

      run1 = await av.updateManualRun({ id: run1.id, items: [baseOutput], status: "completed", state: { x: 1 } })
      session = await av.getSession({ id: session.id })
      expect(session.state).toEqual({ x: 1 })

      // Second run, failed
      let run2 = await av.createManualRun({ sessionId: session.id, items: [baseInput, baseStep, baseOutput], status: "failed", state: { x: 2 } })
      session = await av.getSession({ id: session.id })
      expect(session.state).toEqual({ x: 2 })

      // Retry, successful
      let run3 = await av.createManualRun({ sessionId: session.id, items: [baseInput, baseStep, baseOutput], status: "completed", state: { x: 3 } })
      session = await av.getSession({ id: session.id })
      expect(session.state).toEqual({ x: 3 })

      // can't change state after run is completed
      await expect(av.updateManualRun({ id: run3.id, state: { x: 4 } })).rejects.toThrowError(expect.objectContaining({
        statusCode: 422,
        message: expect.any(String),
      }))
    })



    // METADATA TESTS
    test("create / with known metadata / saved", async () => {
      await updateEnvironment(av, { config: { agents: [{ name: "test", version: "1.0.0" }], channels: [{ type: 'api', name: "test", agent: "test", metadata: { product_id: z.string() } }] } })

      const session = await av.createSession({ agent: "test", userId: initUser1.id, metadata: { product_id: "123" } })
      expect(session).toMatchObject({
        metadata: {
          product_id: "123",
        }
      })
    })

    test("create / optional & nullable metadata / all saved as null", async () => {
      await updateEnvironment(av, { config: { agents: [{ name: "test", version: "1.0.0", metadata: { x: z.nullable(z.string()), y: z.nullable(z.number()) } }] } })

      const session = await av.createSession({ agent: "test", userId: initUser1.id })
      expect(session).toMatchObject({
        metadata: {
          x: null,
          y: null,
        }
      })
    })

    test("create / with known metadata + allowUnknownMetadata=false / saved", async () => {
      await updateEnvironment(av, { config: { agents: [{ name: "test", version: "1.0.0" }], channels: [{ type: 'api', name: "test", agent: "test", metadata: { product_id: z.string() }, allowUnknownMetadata: false }] } })

      const session = await av.createSession({ agent: "test", userId: initUser1.id, metadata: { product_id: "123" } })
      expect(session).toMatchObject({
        metadata: {
          product_id: "123",
        }
      })
    })

    test("create / with unknown metadata / saved", async () => {
      await updateEnvironment(av, { config: { agents: [{ name: "test", version: "1.0.0" }] } })

      const session = await av.createSession({ agent: "test", userId: initUser1.id, metadata: { product_id: "123" } })
      expect(session).toMatchObject({
        metadata: {
          product_id: "123",
        }
      })
    })

    test("create / with unknown metadata + allowUnknownMetadata=false / failed", async () => {
      await updateEnvironment(av, { config: { agents: [{ name: "test", version: "1.0.0", allowUnknownMetadata: false }] } })

      await expect(av.createSession({ agent: "test", userId: initUser1.id, metadata: { product_id: "123" } })).rejects.toThrowError(expect.objectContaining({
        statusCode: 422,
        message: expect.any(String),
      }))
    })

    test("create / with incompatible metadata / fails", async () => {
      await updateEnvironment(av, { config: { agents: [{ name: "test", version: "1.0.0", metadata: { product_id: z.string() } }] } })

      await expect(av.createSession({ agent: "test", userId: initUser1.id, metadata: { product_id: 123 } })).rejects.toThrowError(expect.objectContaining({
        statusCode: 422,
        message: expect.any(String),
      }))
    })


    test("update metadata", async () => {
      await updateEnvironment(av, { config: { agents: [{ name: "test", version: "1.0.0", metadata: { field1: z.string(), field2: z.number() }, allowUnknownMetadata: false }] } })

      const session = await av.createSession({ agent: "test", metadata: { field1: "A", field2: 0 }, userId: initUser1.id })

      const updated = await av.updateSession({ id: session.id, metadata: { field1: "B", field2: 1 } })
      expect(updated.metadata).toEqual({ field1: "B", field2: 1 })

      const fetched = await av.getSession({ id: session.id })
      expect(fetched.metadata).toEqual({ field1: "B", field2: 1 })
    })

    test("update metadata - partial update", async () => {
      await updateEnvironment(av, { config: { agents: [{ name: "test", version: "1.0.0", metadata: { field1: z.string(), field2: z.number() }, allowUnknownMetadata: false }] } })

      const session = await av.createSession({ agent: "test", metadata: { field1: "A", field2: 0 }, userId: initUser1.id })

      const updated = await av.updateSession({ id: session.id, metadata: { field1: "B" } })
      expect(updated.metadata).toEqual({ field1: "B", field2: 0 })

      const fetched = await av.getSession({ id: session.id })
      expect(fetched.metadata).toEqual({ field1: "B", field2: 0 })
    })

    test("update metadata - make field null", async () => {
      await updateEnvironment(av, { config: { agents: [{ name: "test", version: "1.0.0", metadata: { field1: z.string(), field2: z.number().nullable() }, allowUnknownMetadata: false }] } })

      const session = await av.createSession({ agent: "test", metadata: { field1: "A", field2: 0 }, userId: initUser1.id })

      const updated = await av.updateSession({ id: session.id, metadata: { field2: null } })
      expect(updated.metadata).toEqual({ field1: "A", field2: null })

      const fetched = await av.getSession({ id: session.id })
      expect(fetched.metadata).toEqual({ field1: "A", field2: null })
    })

    test("update metadata only - validation enforced", async () => {
      await updateEnvironment(av, { config: { agents: [{ name: "test", version: "1.0.0", metadata: { product_id: z.string() }, allowUnknownMetadata: false }] } })

      const session = await av.createSession({ agent: "test", metadata: { product_id: "A" }, userId: initUser1.id })

      await expect(av.updateSession({ id: session.id, metadata: { wrong: "x" } })).rejects.toThrowError(expect.objectContaining({
        statusCode: 422,
        message: expect.any(String),
      }))
    })

    describe("get session list", () => {
      const USER_1_SESSIONS_COUNT = 20
      const USER_2_SESSIONS_COUNT = 7
      const PROD_USER_SESSIONS_COUNT = 20
      const TOTAL_SESSIONS_COUNT = USER_1_SESSIONS_COUNT + USER_2_SESSIONS_COUNT

      let user1Sessions: StandardSession[] = []
      let user2Sessions: StandardSession[] = []
      let prodUserSessions: StandardSession[] = []

      let agentName = 'agent-for-testing-lists'

      beforeAll(async () => {
        await updateEnvironment(org.prodStandardClient, { config: { agents: [{ name: agentName, version: "1.0.0" }], channels: [{ type: 'api', name: agentName, agent: agentName }] } })

        // Create 20 sessions for testing
        user1Sessions = []
        for (let i = 0; i < USER_1_SESSIONS_COUNT; i++) {
          const session = await org.prodStandardClient.createSession({ agent: agentName, userId: initUser1.id })
          user1Sessions.push(session)
          await new Promise(resolve => setTimeout(resolve, 10)) // Small delay to ensure different updatedAt timestamps
        }

        user2Sessions = []
        for (let i = 0; i < USER_2_SESSIONS_COUNT; i++) {
          const session = await org.prodStandardClient.createSession({ agent: agentName, userId: initUser2.id })
          user2Sessions.push(session)
          await new Promise(resolve => setTimeout(resolve, 10)) // Small delay to ensure different updatedAt timestamps
        }

        prodUserSessions = []
        for (let i = 0; i < PROD_USER_SESSIONS_COUNT; i++) {
          const session = await org.prodStandardClient.createSession({ agent: agentName, userId: initProdUser.id })
          prodUserSessions.push(session)
          await new Promise(resolve => setTimeout(resolve, 10)) // Small delay to ensure different updatedAt timestamps
        }
      })

      test("no pagination params", async () => {
        const result = await org.prodStandardClient.getSessions({ userId: initUser2.id })

        expect(result.sessions).toBeDefined()
        expect(Array.isArray(result.sessions)).toBe(true)
        expect(result.sessions.length).toEqual(USER_2_SESSIONS_COUNT)

        expect(result.pagination).toMatchObject({
          page: 1,
          totalCount: USER_2_SESSIONS_COUNT,
          hasNextPage: false,
          hasPreviousPage: false,
        })
      })

      test("5 items per page, first page", async () => {
        const result = await org.prodStandardClient.getSessions({ userId: initUser2.id, limit: 5, page: 1 })

        expect(result.sessions).toBeDefined()
        expect(result.sessions.length).toBe(5)
        expect(result.pagination).toBeDefined()
        expect(result.pagination.totalCount).toEqual(USER_2_SESSIONS_COUNT)
        expect(result.pagination.page).toBe(1)
        expect(result.pagination.limit).toBe(5)
        expect(result.pagination.totalPages).toEqual(Math.ceil(USER_2_SESSIONS_COUNT / 5))
        expect(result.pagination.hasNextPage).toBe(true)
        expect(result.pagination.hasPreviousPage).toBe(false)
      })

      test("5 items per page, second page", async () => {
        const result = await org.prodStandardClient.getSessions({ userId: initUser2.id, limit: 5, page: 2 })

        expect(result.sessions).toBeDefined()
        expect(result.sessions.length).toBe(USER_2_SESSIONS_COUNT - 5)
        expect(result.pagination).toBeDefined()
        expect(result.pagination.page).toBe(2)
        expect(result.pagination.limit).toBe(5)
        expect(result.pagination.hasNextPage).toBe(false)
        expect(result.pagination.hasPreviousPage).toBe(true)
      })

      test("5 items per page, last page", async () => {
        const itemsPerPage = 5
        const lastPage = Math.ceil(USER_2_SESSIONS_COUNT / itemsPerPage)

        const result = await org.prodStandardClient.getSessions({ userId: initUser2.id, limit: 5, page: lastPage })

        expect(result.sessions).toBeDefined()
        expect(result.sessions.length).toBeGreaterThan(0)
        expect(result.sessions.length).toBeLessThanOrEqual(5)
        expect(result.pagination).toBeDefined()
        expect(result.pagination.page).toBe(lastPage)
        expect(result.pagination.limit).toBe(5)
        expect(result.pagination.hasNextPage).toBe(false)
        expect(result.pagination.hasPreviousPage).toBe(true)
      })


      test("5 items per page, page well beyond last page", async () => {
        const result = await org.prodStandardClient.getSessions({ userId: initUser2.id, limit: 5, page: 100 })

        expect(result.sessions).toBeDefined()
        expect(result.sessions.length).toEqual(0)
        expect(result.pagination).toBeDefined()
        expect(result.pagination.page).toBe(100)
        expect(result.pagination.limit).toBe(5)
        expect(result.pagination.hasNextPage).toBe(false)
        expect(result.pagination.hasPreviousPage).toBe(true)
      })

      test("different page numbers", async () => {
        const page3 = await org.prodStandardClient.getSessions({ space: "playground", limit: 5, page: 3 })
        expect(page3.pagination.page).toBe(3)
        expect(page3.sessions.length).toBe(5)

        const page4 = await org.prodStandardClient.getSessions({ space: "playground", limit: 5, page: 4 })
        expect(page4.pagination.page).toBe(4)
        expect(page4.sessions.length).toBe(5)
      })

      test("page limit exceeds maximum (999999) should error", async () => {
        await expect(org.prodStandardClient.getSessions({ space: "playground", limit: 999999 })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String)
        }))
      })

      test("user scoping works", async () => {
        const user1FetchedSessions = await org.prodStandardClient.asUser(initUser1).getSessions({ space: "playground", limit: 10 })
        const user2FetchedSessions = await org.prodStandardClient.asUser(initUser2).getSessions({ space: "playground", limit: 10 })

        expect(user1FetchedSessions.sessions.length).toBe(10)
        expect(user1FetchedSessions.sessions.every(session => session.userId === initUser1.id)).toBe(true)
        expect(user1FetchedSessions.pagination.totalCount).toBeGreaterThanOrEqual(USER_1_SESSIONS_COUNT)

        expect(user2FetchedSessions.sessions.length).toBe(7)
        expect(user2FetchedSessions.sessions.every(session => session.userId === initUser2.id)).toBe(true)
        expect(user2FetchedSessions.pagination.totalCount).toBe(USER_2_SESSIONS_COUNT)
      })

      test("[public api] works", async () => {
        const avPublic = createStandardClient({
          apiKey: org.apiKeyPublic.key,
        })
        const avPublicAsUser1 = avPublic.asUser({ token: initUser1Token })

        const user1FetchedSessions = await avPublicAsUser1.getSessions({ limit: 10 })

        expect(user1FetchedSessions.sessions.length).toBe(10)
        expect(user1FetchedSessions.sessions.every(session => session.userId === initUser1.id)).toBe(true)
        expect(user1FetchedSessions.pagination.totalCount).toBeGreaterThanOrEqual(USER_1_SESSIONS_COUNT)


        const avPublicAsUser2 = avPublic.asUser({ token: initUser2Token })

        const user2FetchedSessions = await avPublicAsUser2.getSessions({ limit: 10 })

        expect(user2FetchedSessions.sessions.length).toBe(7)
        expect(user2FetchedSessions.sessions.every(session => session.userId === initUser2.id)).toBe(true)
        expect(user2FetchedSessions.pagination.totalCount).toBe(USER_2_SESSIONS_COUNT)
      })

    })


    describe("runs", () => {
      test("creating run with non-existing sessionId", async () => {
        await updateConfig()

        await expect(av.createManualRun({ sessionId: 'non-existing', items: [baseInput] })).rejects.toThrowError(expect.objectContaining({
          statusCode: 404,
          message: expect.any(String),
        }))
      })

      test("updating run with non-existing run id", async () => {
        await updateConfig()

        await expect(av.updateManualRun({ id: 'non-existing', items: [baseOutput] })).rejects.toThrowError(expect.objectContaining({
          statusCode: 404,
          message: expect.any(String),
        }))
      })

      test("creating run without items", async () => {
        await updateConfig()
        const session = await createSession()

        await expect(av.createManualRun({ sessionId: session.id, items: [] })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String),
        }))
      })

      test("new run defaults to in_progress status", async () => {
        await updateConfig()
        const session = await createSession()

        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] })
        expect(run.status).toBe("in_progress")
      })

      test("cannot create new run while previous is in progress", async () => {
        await updateConfig()
        const session = await createSession()

        await av.createManualRun({ sessionId: session.id, items: [baseInput] })
        await expect(av.createManualRun({ sessionId: session.id, items: [baseInput] })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String),
        }))
      })

 
 
 
 
      /** 
       * RUN STATES TESTS 
       * 
       * This is automated set of test cases where we test different scenarios of runs.
       **/

      // TODO: Better error messages from bad matches!!!

      const baseTestCases: Array<{ title: string, scenarios: any[], lastRunStatus: ("in_progress" | "completed" | "failed" | undefined)[], error?: number | null, validateOutput?: boolean, strictMatching?: boolean, only?: boolean }> = [
        {
          title: "just input & output",
          scenarios: [
            [[baseInput, baseOutput]],
            [[baseInput], [baseOutput]]
          ],
          lastRunStatus: ["completed", "failed"],
          error: null
        },
        {
          title: "input, 2 items, output",
          scenarios: [
            [[baseInput, baseStep, baseStep, baseOutput]],
            [[baseInput], [baseStep], [baseStep], [baseOutput]],
            [[baseInput], [baseStep, baseStep], [baseOutput]],
            [[baseInput], [baseStep, baseStep, baseOutput]],
          ],
          lastRunStatus: ["completed", "failed", undefined], // in_progress (undefined) doesn't throw because we don't validate steps -> therefore output can be treated as step. 
          error: null
        },
        {
          title: "input, 2 items, output",
          scenarios: [
            [[baseInput, baseStep, baseStep, baseOutput]],
            [[baseInput], [baseStep], [baseStep], [baseOutput]],
            [[baseInput], [baseStep, baseStep], [baseOutput]],
            [[baseInput], [baseStep, baseStep, baseOutput]],
          ],
          lastRunStatus: [undefined],
          validateOutput: true,
          error: null, // items matching output schema are also accepted during streaming (step/output distinction happens on completion)
        },
        {
          title: "input, 2 steps, no output",
          scenarios: [
            [[baseInput, baseStep, baseStep]],
            [[baseInput], [baseStep], [baseStep]],
            [[baseInput], [baseStep, baseStep]],
          ],
          lastRunStatus: ["failed"],
          error: null
        },
        {
          title: "input, 2 items, no output (valid - any output schema matches)",
          scenarios: [
            [[baseInput, baseStep, baseStep]],
            [[baseInput], [baseStep], [baseStep]],
            [[baseInput], [baseStep, baseStep]],
          ],
          lastRunStatus: ["completed"],
          error: null
        },
        {
          title: "single item",
          scenarios: [
            [[baseInput]],
          ],
          lastRunStatus: ["completed"],
          error: 422
        },
        {
          title: "single item",
          scenarios: [
            [[baseInput]],
          ],
          lastRunStatus: ["failed"],
          error: null
        },

        // Validation
        {
          title: "loose matching -> extra fields saved",
          scenarios: [
            [[baseInputExt, baseStepExt, baseStepExt, baseOutputExt]],
            [[baseInputExt], [baseStepExt], [baseStepExt], [baseOutputExt]],
            [[baseInputExt], [baseStepExt, baseStepExt], [baseOutputExt]],
            [[baseInputExt], [baseStepExt, baseStepExt, baseOutputExt]],
          ],
          lastRunStatus: ["completed", "failed"],
          error: null
        },
        // TEMORARILY COMMENTED OUT. IT DOESN'T MATTER NOW.
        // {
        //   title: "strict matching -> extra fields trimmed",
        //   strictMatching: true,
        //   scenarios: [
        //     [[baseInputExt, baseOutputExt]],
        //     [[baseInput], [baseStep, baseStep], [baseOutputExt]],
        //     [[baseInput, baseStep, baseStep, baseOutputExt]],
        //   ],
        //   lastRunStatus: ["completed"],
        //   error: null
        // },
        {
          title: "incorrect input item",
          scenarios: [
            [[wrongInput]],
            [[wrongInput, baseStep]],
            [[wrongInput, baseStep, baseStep, baseOutput]]
          ],
          lastRunStatus: ["completed", "failed"],
          error: 422
        },
        {
          title: "incorrect output item",
          scenarios: [
            [[baseInput, baseStep, wrongOutput]],
            [[baseInput], [baseStep], [wrongOutput]],
            [[baseInput], [baseStep, wrongOutput]],
          ],
          lastRunStatus: ["completed"],
          error: 422,
          validateOutput: true,
        },
        {
          title: "incorrect output item",
          scenarios: [
            [[baseInput, baseStep, wrongOutput]],
            [[baseInput], [baseStep], [wrongOutput]],
            [[baseInput], [baseStep, wrongOutput]],
          ],
          lastRunStatus: ["failed"],
          error: null // when there is no step validation and status becomes "failed", we don't know if the last item was output or step
        },
        {
          title: "incorrect step item, validateOutput=false",
          scenarios: [
            [[baseInput, baseStep, wrongStep]],
            [[baseInput], [baseStep], [wrongStep]],
            [[baseInput], [baseStep, wrongStep]],
          ],
          // validateOutput: false -> default
          lastRunStatus: [undefined],
          error: null,
        },
        {
          title: "incorrect step item, validateOutput=true",
          scenarios: [
            [[baseInput, baseStep, wrongStep]],
            [[baseInput], [baseStep], [wrongStep]],
            [[baseInput], [baseStep, wrongStep]],
          ],
          validateOutput: true,
          lastRunStatus: [undefined],
          error: 422,
        },
        // Tool calls validation
        {
          title: "tool calls, correct call, sequential",
          scenarios: [
            [[baseInput, fun1Call("xxx"), funResult("xxx"), baseOutput]],
            [[baseInput, fun1Call("xxx"), funResult("xxx"), fun2Call("yyy"), funResult("yyy"), baseOutput]],
            [[baseInput], [fun1Call("id1")], [funResult("id1")], [fun2Call("id2")], [funResult("id2")], [baseOutput]],
            [[baseInput], [fun1Call("id1")], [funResult("id1"), fun2Call("id2")], [funResult("id2"), baseOutput]],
          ],
          validateOutput: true,
          lastRunStatus: ["completed", "failed"],
          error: null,
        },
        {
          title: "tool calls, correct call, paralell",
          scenarios: [
            [[baseInput, fun1Call("1"), fun2Call("2"), fun1Call("3"), funResult("3"), funResult("1"), funResult("2"), baseOutput]],
          ],
          validateOutput: true,
          lastRunStatus: ["completed", "failed"],
          error: null,
        },
        {
          title: "tool calls, not matching result",
          scenarios: [
            [[baseInput, funResult("xxx")]],
            [[baseInput], [funResult("xxx")]],

            [[baseInput, fun1Call("xxx"), funResult("xxx_different")]],
            [[baseInput], [fun1Call("xxx")], [funResult("xxx_different")]],
          ],
          validateOutput: true,
          lastRunStatus: [undefined],
          error: 422,
        },
      ]

      for (const testCase of baseTestCases) {
        let counter = 0;
        for (const scenario of testCase.scenarios) {
          counter++;

          for (const lastRunStatus of testCase.lastRunStatus) {
            const title = `${testCase.title} / scenario ${counter} / ${lastRunStatus} -> ${testCase.error ? `error ${testCase.error}` : "ok"}`

            const testFn = testCase.only ? test.only : test;

            testFn(title, async () => {
              await updateConfig({ strictMatching: testCase.strictMatching, validateOutput: testCase.validateOutput });

              const session = await createSession()

              let run: StandardRun | undefined;
              let expected_history: any[] = [];

              for (const iteration of scenario) {
                const isLast = iteration === scenario[scenario.length - 1];
                const isFirst = iteration === scenario[0];

                let expectedStatus: string;
                let expectedHasFinishedAt: boolean;
                let promise: any;

                if (isFirst && isLast) {
                  promise = av.createManualRun({ sessionId: session.id, items: iteration, status: lastRunStatus });
                  expectedStatus = lastRunStatus ?? "in_progress";
                  expectedHasFinishedAt = expectedStatus !== "in_progress";
                } else if (isLast) {
                  promise = av.updateManualRun({ id: run!.id, items: iteration, status: lastRunStatus })
                  expectedStatus = lastRunStatus ?? "in_progress";
                  expectedHasFinishedAt = expectedStatus !== "in_progress";
                } else if (isFirst) {
                  promise = av.createManualRun({ sessionId: session.id, items: iteration })
                  expectedStatus = "in_progress";
                  expectedHasFinishedAt = false;
                } else {
                  promise = av.updateManualRun({ id: run!.id, items: iteration })
                  expectedStatus = "in_progress";
                  expectedHasFinishedAt = false;
                }

                if (testCase.error && isLast) {
                  await expect(promise).rejects.toThrowError(expect.objectContaining({
                    statusCode: testCase.error,
                    message: expect.any(String),
                  }))

                  const { items, lastRun } = await av.getSession({ id: session.id });
                  expect(deepCompare(items, expected_history)).toBe(true)

                  if (lastRun) {
                    expect(lastRun.status).toBe("in_progress")
                  }
                }
                else {
                  run = await promise! as StandardRun;
                  expect(run.status).toBe(expectedStatus)

                  if (expectedHasFinishedAt) {
                    expect(run.finishedAt).toBeTruthy()
                  } else {
                    expect(run.finishedAt).toBeNull()
                  }

                  if (testCase.strictMatching) {
                    expected_history = [...expected_history, ...removeDoubleUnderscoreKeys(iteration)]; // for strict matching we expect all the extra fields to be trimmed, we represent them as __{field}
                  }
                  else {
                    expected_history = [...expected_history, ...iteration];
                  }

                  const { lastRun, items } = await av.getSession({ id: session.id });

                  // console.log('history', history);
                  // console.log('expected_history', expected_history);
                  expect(deepCompare(items, expected_history)).toBe(true)

                  expect(lastRun?.status).toBe(expectedStatus)
                }
              }
            })
          }
        }
      }


      test("cannot add items or change status after completion", async () => {
        await updateConfig()
        const session = await createSession()

        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] })
        const completed = await av.updateManualRun({ id: run.id, items: [baseOutput], status: "completed", metadata: { trace_id: "abc" } })
        expect(completed.status).toBe("completed")

        await expect(av.updateManualRun({ id: run.id, items: [baseStep] })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String),
        }))

        await expect(av.updateManualRun({ id: run.id, status: "failed" })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String),
        }))

      })

      test("failReason can be set only on failed runs", async () => {
        await updateConfig()
        const session = await createSession()

        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] })

        const failReason = { message: "oops" }

        await expect(av.updateManualRun({ id: run.id, items: [baseStep], failReason })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String),
        }))

        await expect(av.updateManualRun({ id: run.id, items: [baseOutput], failReason, status: "completed" })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String),
        }))

        const updated = await av.updateManualRun({ id: run.id, items: [baseOutput], status: "failed", failReason })
        expect(updated.failReason).toEqual(failReason)
      })


      test("userToken scoped permissions", async () => {
        await updateConfig()
        const session = await createSession()

        await expect(av.asUser(initUser2).createManualRun({ sessionId: session.id, items: [baseInput] })).rejects.toThrowError(expect.objectContaining({
          statusCode: 401,
          message: expect.any(String),
        }))
      })

      // VERSIONING

      describe("versioning", () => {
        test("incorrect version format in config fails at session creation", async () => {
          await updateConfig({ version: "xxx" })
          await expectToFail(av.createSession({ agent: "test", userId: initUser1.id }), 422)

          await updateConfig({ version: "blah.blah.blah" })
          await expectToFail(av.createSession({ agent: "test", userId: initUser1.id }), 422)
        })

        test("compatibility enforced across config version changes", async () => {
          await updateConfig({ version: "1.2" })
          const session = await createSession()

          await av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed" }) // 1.2 -> ok

          await updateConfig({ version: "1.2.3" })
          await av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed" }) // same major, higher -> ok

          await updateConfig({ version: "1.2.4" })
          await av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed" }) // higher patch -> ok

          await updateConfig({ version: "1.3.0" })
          await av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed" }) // higher minor -> ok

          await updateConfig({ version: "1.2.2" })
          await expectToFail(av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput] }), 422) // smaller patch fails

          await updateConfig({ version: "2.0.0" })
          await expectToFail(av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput] }), 422) // different major fails

          // suffixes
          await updateConfig({ version: "1.3.3" })
          await av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed" })

          await updateConfig({ version: "1.3.3-dev" })
          await av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed" })

          await updateConfig({ version: "1.3.3-xxx" })
          await av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed" })

          await updateConfig({ version: "1.3.4" })
          await av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed" })

          await updateConfig({ version: "1.3.4-local" })
          await av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed" })

          await updateConfig({ version: "1.3.3-local" })
          await expectToFail(av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput] }), 422) // smaller patch fails even with suffix

          await updateConfig({ version: "1.3.3-xxx" })
          await expectToFail(av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput] }), 422) // smaller patch with different suffix fails

          await updateConfig({ version: "2.0.0" })
          await expectToFail(av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput] }), 422) // different major fails

          await updateConfig({ version: "2.0.0-dev" })
          await expectToFail(av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput] }), 422) // different major with suffix fails
        })

        test("version stored as-is", async () => {
          await updateConfig({ version: "1.3.0" })
          const session = await createSession()
          const run = await av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput] })
          expect(run.agentRef?.version).toBe("1.3.0")
        })

        test("suffixed version stored as-is", async () => {
          await updateConfig({ version: "1.3.0-xxx" })
          const session = await createSession()
          const run = await av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput] })
          expect(run.agentRef?.version).toBe("1.3.0-xxx")
        })
      });

      // METADATA

      test("create / with known metadata / saved", async () => {
        await updateConfig({ runMetadata: { product_id: z.string() } })
        const session = await createSession()
        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput], metadata: { product_id: "123" } })

        expect(run.metadata).toMatchObject({
          product_id: "123",
        })
      })

      test("create / optional & nullable metadata / all saved as null", async () => {
        await updateConfig({ runMetadata: { x: z.nullable(z.string()), y: z.nullable(z.number()) } })

        const session = await createSession()
        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput], metadata: { product_id: "123" } })

        expect(run.metadata).toMatchObject({
          x: null,
          y: null,
        })
      })

      test("create / with known metadata + allowUnknownMetadata=false / saved", async () => {
        await updateConfig({ runMetadata: { product_id: z.string() }, allowUnknownMetadata: false })

        const session = await createSession()
        const run = await av.createManualRun({
          sessionId: session.id,
          items: [baseInput],
          metadata: { product_id: "123" }
        })

        expect(run.metadata).toMatchObject({
          product_id: "123",
        })
      })

      test("create / with unknown metadata / saved", async () => {
        await updateConfig()
        const session = await createSession()
        const run = await av.createManualRun({
          sessionId: session.id,
          items: [baseInput],
          metadata: { product_id: "123" }
        })

        expect(run.metadata).toMatchObject({
          product_id: "123",
        })
      })

      test("create / with unknown metadata + allowUnknownMetadata=false / failed", async () => {
        await updateConfig({ allowUnknownMetadata: false })

        const session = await createSession()
        await expect(av.createManualRun({
          sessionId: session.id,
          items: [baseInput],
          metadata: { product_id: "123" }
        })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String),
        }))
      })

      test("create / with incompatible metadata / fails", async () => {
        await updateConfig({ runMetadata: { product_id: z.string() } })

        const session = await createSession()
        await expect(av.createManualRun({
          sessionId: session.id,
          items: [baseInput],
          metadata: { product_id: 123 }
        })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String),
        }))
      })

      test("update metadata", async () => {
        await updateConfig({ runMetadata: { field1: z.string(), field2: z.number() }, allowUnknownMetadata: false })

        const session = await createSession()
        const run = await av.createManualRun({
          sessionId: session.id,
          items: [baseInput],
          metadata: { field1: "A", field2: 0 }
        })

        const updated = await av.updateManualRun({ id: run.id, metadata: { field1: "B", field2: 1 } })
        expect(updated.metadata).toEqual({ field1: "B", field2: 1 })
      })

      test("update metadata - partial update", async () => {
        await updateConfig({ runMetadata: { field1: z.string(), field2: z.number() }, allowUnknownMetadata: false })

        const session = await createSession()
        const run = await av.createManualRun({
          sessionId: session.id,
          items: [baseInput],
          metadata: { field1: "A", field2: 0 }
        })

        const updated = await av.updateManualRun({ id: run.id, metadata: { field1: "B" } })
        expect(updated.metadata).toEqual({ field1: "B", field2: 0 })
      })

      test("update metadata - make field null", async () => {
        await updateConfig({ runMetadata: { field1: z.string(), field2: z.number().nullable() }, allowUnknownMetadata: false })

        const session = await createSession()
        const run = await av.createManualRun({
          sessionId: session.id,
          items: [baseInput],
          metadata: { field1: "A", field2: 0 }
        })

        const updated = await av.updateManualRun({ id: run.id, metadata: { field2: null } })
        expect(updated.metadata).toEqual({ field1: "A", field2: null })
      })

      test("update metadata only - validation enforced", async () => {
        await updateConfig({ runMetadata: { product_id: z.string() }, allowUnknownMetadata: false })

        const session = await createSession()
        const run = await av.createManualRun({
          sessionId: session.id,
          items: [baseInput],
          metadata: { product_id: "A" }
        })

        await expect(av.updateManualRun({ id: run.id, metadata: { wrong: "x" } })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String),
        }))
      })

      test("metadata can be updated AFTER the run is completed", async () => {
        await updateConfig({ runMetadata: { product_id: z.string() } })
        const session = await createSession()
        let run = await av.createManualRun({ sessionId: session.id, items: [baseInput], metadata: { product_id: "123" } })

        expect(run.metadata).toMatchObject({
          product_id: "123",
        })

        run = await av.updateManualRun({ id: run.id, items: [baseOutput], status: "completed", metadata: { product_id: "456" } })
        expect(run.metadata).toMatchObject({
          product_id: "456",
        })

        run = await av.updateManualRun({ id: run.id, metadata: { product_id: "789" } })
        expect(run.metadata).toMatchObject({
          product_id: "789",
        })
      })

    })

    // sessions.updateRun (PATCH /api/sessions/:session_id/runs/:run_id) — ai-sdk adapter only
    describe("updateRun metadata (ai-sdk)", () => {
      test("update metadata", async () => {
        await updateConfig({ adapter: 'ai-sdk', runMetadata: { field1: z.string(), field2: z.number() }, allowUnknownMetadata: false })
        const session = await createSession()
        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput], metadata: { field1: "A", field2: 0 } })

        await av.updateRun({ sessionId: session.id, runId: run.id, metadata: { field1: "B", field2: 1 } })
        const fetched = await av.getSession({ id: session.id })
        const updatedRun = fetched.runs.find(r => r.id === run.id)
        expect(updatedRun!.metadata).toEqual({ field1: "B", field2: 1 })
      })

      test("update metadata - partial update", async () => {
        await updateConfig({ adapter: 'ai-sdk', runMetadata: { field1: z.string(), field2: z.number() }, allowUnknownMetadata: false })
        const session = await createSession()
        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput], metadata: { field1: "A", field2: 0 } })

        await av.updateRun({ sessionId: session.id, runId: run.id, metadata: { field1: "B" } })
        const fetched = await av.getSession({ id: session.id })
        const updatedRun = fetched.runs.find(r => r.id === run.id)
        expect(updatedRun!.metadata).toEqual({ field1: "B", field2: 0 })
      })

      test("update metadata - make field null", async () => {
        await updateConfig({ adapter: 'ai-sdk', runMetadata: { field1: z.string(), field2: z.number().nullable() }, allowUnknownMetadata: false })
        const session = await createSession()
        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput], metadata: { field1: "A", field2: 0 } })

        await av.updateRun({ sessionId: session.id, runId: run.id, metadata: { field2: null } })
        const fetched = await av.getSession({ id: session.id })
        const updatedRun = fetched.runs.find(r => r.id === run.id)
        expect(updatedRun!.metadata).toEqual({ field1: "A", field2: null })
      })

      test("update metadata - validation enforced", async () => {
        await updateConfig({ adapter: 'ai-sdk', runMetadata: { product_id: z.string() }, allowUnknownMetadata: false })
        const session = await createSession()
        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput], metadata: { product_id: "A" } })

        await expect(av.updateRun({ sessionId: session.id, runId: run.id, metadata: { wrong: "x" } })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String),
        }))
      })

      test("metadata can be updated AFTER the run is completed", async () => {
        await updateConfig({ adapter: 'ai-sdk', runMetadata: { product_id: z.string() } })
        const session = await createSession()
        const run = await av.createManualRun({
          sessionId: session.id,
          items: [baseInput],
          metadata: { product_id: "123", assistantMessage: { id: "assistant-1" } }
        })

        await av.updateManualRun({ id: run.id, items: [baseOutput], status: "completed" })

        await av.updateRun({ sessionId: session.id, runId: run.id, metadata: { product_id: "456" } })
        const fetched = await av.getSession({ id: session.id })
        const updatedRun = fetched.runs.find(r => r.id === run.id)
        expect(updatedRun!.metadata).toMatchObject({ product_id: "456" })
      })

      test("fails for non-ai-sdk adapter", async () => {
        await updateConfig({ runMetadata: { product_id: z.string() } })
        const session = await createSession()
        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput], metadata: { product_id: "123" } })

        await expect(av.updateRun({ sessionId: session.id, runId: run.id, metadata: { product_id: "456" } })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String),
        }))
      })
    })

    describe("step/output item types", () => {
      test("items during in_progress have type: 'step'", async () => {
        await updateConfig()
        const session = await createSession()

        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] })
        const updated = await av.updateManualRun({ id: run.id, items: [baseStep] })

        // Non-input items should be 'step' while run is in progress
        const stepItem = updated.sessionItems.find(si => si.content.type === 'reasoning')
        expect(stepItem).toBeDefined()
        expect(stepItem!.type).toBe('step')
      })

      test("last item converts to type: 'output' on completion", async () => {
        await updateConfig()
        const session = await createSession()

        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] })
        await av.updateManualRun({ id: run.id, items: [baseStep] })
        const completed = await av.updateManualRun({ id: run.id, items: [baseOutput], status: "completed" })

        // Input should be 'input'
        expect(completed.sessionItems[0].type).toBe('input')
        // Step should stay 'step'
        expect(completed.sessionItems[1].type).toBe('step')
        // Last item (output) should be 'output'
        expect(completed.sessionItems[2].type).toBe('output')
      })

      test("outputItemCount controls how many items become output", async () => {
        await updateConfig()
        const session = await createSession()

        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] })
        await av.updateManualRun({ id: run.id, items: [baseStep, baseOutput, baseOutput] })
        const completed = await av.updateManualRun({ id: run.id, status: "completed", outputItemCount: 2 })

        // Input should be 'input'
        expect(completed.sessionItems[0].type).toBe('input')
        // Step should stay 'step'
        expect(completed.sessionItems[1].type).toBe('step')
        // Last 2 items should be 'output'
        expect(completed.sessionItems[2].type).toBe('output')
        expect(completed.sessionItems[3].type).toBe('output')
      })

      test("failed runs have all items as type: 'step'", async () => {
        await updateConfig()
        const session = await createSession()

        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] })
        await av.updateManualRun({ id: run.id, items: [baseStep] })
        const failed = await av.updateManualRun({ id: run.id, status: "failed", failReason: { message: "error" } })

        // Input should be 'input'
        expect(failed.sessionItems[0].type).toBe('input')
        // Step should stay 'step' (no output marking for failed)
        expect(failed.sessionItems[1].type).toBe('step')
      })

      test("cancelled runs have all items as type: 'step'", async () => {
        await updateConfig()
        const session = await createSession()

        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] })
        await av.updateManualRun({ id: run.id, items: [baseStep] })
        const cancelled = await av.updateManualRun({ id: run.id, status: "cancelled" })

        expect(cancelled.sessionItems[0].type).toBe('input')
        expect(cancelled.sessionItems[1].type).toBe('step')
      })

      test("outputItemCount rejected when status is not 'completed'", async () => {
        await updateConfig()
        const session = await createSession()

        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] })
        await av.updateManualRun({ id: run.id, items: [baseStep] })

        await expectToFail(av.updateManualRun({ id: run.id, items: [baseOutput], outputItemCount: 1 }), 422)
        await expectToFail(av.updateManualRun({ id: run.id, status: "failed", failReason: { message: "error" }, outputItemCount: 1 }), 422)
      })

      test("run created with status: 'completed' has output items marked", async () => {
        await updateConfig()
        const session = await createSession()

        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed" })
        const fetchedSession = await av.getSession({ id: session.id })
        const fetchedRun = fetchedSession.runs[0]

        expect(fetchedRun.sessionItems[0].type).toBe('input')
        expect(fetchedRun.sessionItems[1].type).toBe('output')
      })
    })

    describe("keep-alive and expiration", () => {
      const SHORT_TIMEOUT = 3000; // 3 seconds - worker runs every 1s

      const updateConfigWithTimeout = async (idleTimeout: number) => {
        const inputSchema = z.looseObject({ type: z.literal("message"), role: z.literal("user"), content: z.string() })
        const outputSchema = z.looseObject({ type: z.literal("message"), role: z.literal("assistant"), content: z.string() })

        const config = {
          agents: [
            {
              name: "test",
              version: "1.0.0",
              runs: [
                {
                  input: { schema: inputSchema },
                  output: [{ schema: outputSchema }],
                  idleTimeout,
                }
              ]
            }
          ],
          channels: [
            { type: 'api' as const, name: "test", agent: "test" }
          ]
        }

        await updateEnvironment(av, { config })
      }

      test("keepAliveRun returns expiresAt timestamp for in_progress run", async () => {
        await updateConfigWithTimeout(SHORT_TIMEOUT)
        const session = await av.createSession({ agent: "test", userId: initUser1.id})
        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] })

        expect(run.status).toBe("in_progress")

        const result = await av.keepAliveRun({ id: run.id })
        expect(result.expiresAt).not.toBeNull()
        expect(typeof result.expiresAt).toBe("string")

        // expiresAt should be in the future
        const expiresAtTime = new Date(result.expiresAt!).getTime()
        expect(expiresAtTime).toBeGreaterThan(Date.now())
      })

      test("keepAliveRun returns null expiresAt for completed run", async () => {
        await updateConfigWithTimeout(SHORT_TIMEOUT)
        const session = await av.createSession({ agent: "test", userId: initUser1.id})
        const run = await av.createManualRun({
          sessionId: session.id,
          items: [baseInput, baseOutput],
          status: "completed"
        })

        expect(run.status).toBe("completed")

        const result = await av.keepAliveRun({ id: run.id })
        expect(result.expiresAt).toBeNull()
      })

      test("run expires when idle timeout passes without keep-alive", async () => {
        await updateConfigWithTimeout(SHORT_TIMEOUT)
        const session = await av.createSession({ agent: "test", userId: initUser1.id})
        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] })

        expect(run.status).toBe("in_progress")

        // Wait for expiration (timeout + worker interval buffer ~1s)
        await new Promise(resolve => setTimeout(resolve, SHORT_TIMEOUT * 2))

        const updatedSession = await av.getSession({ id: session.id })

        expect(updatedSession.lastRun).toBeDefined()
        expect(updatedSession.lastRun!.status).toBe("failed")
        expect(updatedSession.lastRun!.failReason).toMatchObject({ message: "Timeout" })
      }, 10000) // 10s timeout for this test

      test("keep-alive prevents expiration", async () => {
        await updateConfigWithTimeout(SHORT_TIMEOUT)
        const session = await av.createSession({ agent: "test", userId: initUser1.id})
        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] })

        expect(run.status).toBe("in_progress")

        // Keep the run alive by calling keepAliveRun before timeout expires
        // Call it 3 times with 3s intervals (total 9s) while timeout is 6s
        for (let i = 0; i < 3; i++) {
          await new Promise(resolve => setTimeout(resolve, SHORT_TIMEOUT / 2))
          const result = await av.keepAliveRun({ id: run.id })
          expect(result.expiresAt).not.toBeNull()
        }

        // Run should still be in_progress
        const updatedSession = await av.getSession({ id: session.id })
        const stillAliveRun = updatedSession.runs?.find(r => r.id === run.id)

        expect(stillAliveRun).toBeDefined()
        expect(stillAliveRun!.status).toBe("in_progress")
      }, 10000) // 20s timeout for this test

      test("update run also resets expiration timer", async () => {
        await updateConfigWithTimeout(3000)
        const session = await av.createSession({ agent: "test", userId: initUser1.id})
        const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] })

        expect(run.status).toBe("in_progress")

        // Wait half the timeout time, then update the run with output (should reset timer)
        await new Promise(resolve => setTimeout(resolve, 2000))
        await av.updateManualRun({ id: run.id, items: [baseOutput], status: "in_progress" })

        // Wait another full timeout time
        await new Promise(resolve => setTimeout(resolve, 2000)) // total 4 seconds of waiting

        const updatedSession = await av.getSession({ id: session.id })
        const stillAliveRun = updatedSession.runs?.find(r => r.id === run.id)

        expect(stillAliveRun).toBeDefined()
        expect(stillAliveRun!.status).toBe("in_progress")
      }, 15000) // 15s timeout for this test
    })

    /**
     * Webhook job tests - session.on_first_run_created
     *
     * These tests use a mock HTTP server to receive and verify webhook calls.
     * The webhookUrl is configured via the config (not env var).
     */
    describe.skip("webhook jobs - session.on_first_run_created", () => {
      const WEBHOOK_PORT = 3456;
      const WEBHOOK_URL = `http://localhost:${WEBHOOK_PORT}/webhook`;

      // Shared mock server state
      let mockServer: {
        server: import('http').Server;
        requests: Array<{ body: any; timestamp: number }>;
        close: () => Promise<void>;
        setResponseHandler: (handler: (callIndex: number) => { status: number; body: any }) => void;
        resetCallIndex: () => void;
      } | null = null;

      // Create mock server with configurable response behavior
      async function createMockWebhookServer(port: number) {
        const http = await import('http');
        const requests: Array<{ body: any; timestamp: number }> = [];
        let callIndex = 0;
        let responseHandler: (callIndex: number) => { status: number; body: any } = () => ({ status: 200, body: { ok: true } });

        const server = await new Promise<import('http').Server>((resolve) => {
          const srv = http.createServer((req, res) => {
            let body = '';
            req.on('data', (chunk: Buffer) => body += chunk.toString());
            req.on('end', () => {
              const currentCall = callIndex++;
              try {
                requests.push({ body: JSON.parse(body), timestamp: Date.now() });
              } catch {
                requests.push({ body, timestamp: Date.now() });
              }

              const response = responseHandler(currentCall);
              res.writeHead(response.status, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(response.body));
            });
          });
          srv.listen(port, () => resolve(srv));
        });

        return {
          server,
          requests,
          close: () => new Promise<void>(r => server.close(r as () => void)),
          setResponseHandler: (handler: (callIndex: number) => { status: number; body: any }) => {
            responseHandler = handler;
          },
          resetCallIndex: () => { callIndex = 0; },
        };
      }

      // Helper to wait for webhook call with timeout
      async function waitForWebhook(
        predicate: (req: { body: any }) => boolean,
        timeoutMs: number = 10000
      ): Promise<{ body: any } | null> {
        if (!mockServer) throw new Error('Mock server not initialized');
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
          const match = mockServer.requests.find(predicate);
          if (match) return match;
          await new Promise(r => setTimeout(r, 500));
        }
        return null;
      }

      // Helper to update config with webhookUrl
      const updateConfigWithWebhook = async () => {
        const inputSchema = z.looseObject({ type: z.literal("message"), role: z.literal("user"), content: z.string() });
        const outputSchema = z.looseObject({ type: z.literal("message"), role: z.literal("assistant"), content: z.string() });
        const stepSchema = z.looseObject({ type: z.literal("reasoning"), content: z.string() });
        const functionCallSchema = z.looseObject({ type: z.literal("function_call"), name: z.string(), callId: z.string().meta({ callId: true }) });
        const functionResultSchema = z.looseObject({ type: z.literal("function_call_result"), callId: z.string().meta({ callId: true }) });

        await updateEnvironment(av, {
          config: {
            webhookUrl: WEBHOOK_URL,
            agents: [{
              name: "test",
              version: "1.0.0",
              runs: [{
                input: { schema: inputSchema },
                output: [{ schema: stepSchema }, { schema: functionCallSchema, callResult: { schema: functionResultSchema } }, { schema: outputSchema }],
              }]
            }],
            channels: [{ type: 'api', name: "test", agent: "test" }],
          },
        });
      };

      // Start mock server before all webhook tests
      beforeAll(async () => {
        mockServer = await createMockWebhookServer(WEBHOOK_PORT);
      });

      // Close mock server after all webhook tests
      afterAll(async () => {
        if (mockServer) {
          await mockServer.close();
          mockServer = null;
        }
      });

      // Reset server state before each test
      beforeEach(() => {
        if (mockServer) {
          mockServer.requests.length = 0;
          mockServer.resetCallIndex();
          mockServer.setResponseHandler(() => ({ status: 200, body: { ok: true } }));
        }
      });

      test("first run triggers webhook with session_id", async () => {
        await updateConfigWithWebhook();
        const session = await av.createSession({ agent: "test", userId: initUser1.id});

        const run = await av.createManualRun({
          sessionId: session.id,
          items: [baseInput],
        });
        expect(run).toBeDefined();

        const webhookCall = await waitForWebhook(
          (req) => req.body?.event === 'session.on_first_run_created' && req.body?.payload?.session_id === session.id,
          15000
        );

        expect(webhookCall).not.toBeNull();
        expect(webhookCall!.body.event).toBe('session.on_first_run_created');
        expect(webhookCall!.body.payload.session_id).toBe(session.id);
        expect(webhookCall!.body.job_id).toBeDefined();
      }, 20000);

      test("second run does NOT trigger webhook", async () => {
        await updateConfigWithWebhook();
        const session = await av.createSession({ agent: "test", userId: initUser1.id});

        // Create first run
        const run1 = await av.createManualRun({
          sessionId: session.id,
          items: [baseInput, baseOutput],
          status: "completed"
        });
        expect(run1).toBeDefined();

        // Wait for first webhook
        const firstWebhook = await waitForWebhook(
          (req) => req.body?.event === 'session.on_first_run_created' && req.body?.payload?.session_id === session.id,
          15000
        );
        expect(firstWebhook).not.toBeNull();

        const countAfterFirstRun = mockServer!.requests.length;

        // Create second run
        const run2 = await av.createManualRun({
          sessionId: session.id,
          items: [baseInput, baseOutput],
          status: "completed"
        });
        expect(run2).toBeDefined();

        // Wait to ensure no new webhook is triggered
        await new Promise(r => setTimeout(r, 7000));

        const newWebhooks = mockServer!.requests.filter(
          (req, idx) => idx >= countAfterFirstRun && req.body?.payload?.session_id === session.id
        );
        expect(newWebhooks.length).toBe(0);
      }, 30000);

      test("webhook is retried on error response (at-least-once delivery)", async () => {
        // Configure server to fail first 2 calls, succeed on 3rd
        mockServer!.setResponseHandler((callIndex) => {
          if (callIndex < 2) {
            return { status: 500, body: { error: 'Simulated failure' } };
          }
          return { status: 200, body: { ok: true } };
        });

        await updateConfigWithWebhook();
        const session = await av.createSession({ agent: "test", userId: initUser1.id});

        const run = await av.createManualRun({
          sessionId: session.id,
          items: [baseInput],
        });
        expect(run).toBeDefined();

        // Wait for retries (retry delays: 5s, 30s, 2min)
        await new Promise(r => setTimeout(r, 15000));

        const sessionWebhooks = mockServer!.requests.filter(
          req => req.body?.payload?.session_id === session.id
        );

        // Expect at least 2 calls (initial + retry)
        expect(sessionWebhooks.length).toBeGreaterThanOrEqual(2);

        // All calls should have same event type and session_id
        for (const webhook of sessionWebhooks) {
          expect(webhook.body.event).toBe('session.on_first_run_created');
          expect(webhook.body.payload.session_id).toBe(session.id);
        }
      }, 30000);
    });

    // describe('Session AI Summaries', () => {
    //   test('session summary remains null by default in this test set', async () => {
    //     // Create a session
    //     const session = await av.createSession({ userId: initUser1.id, agent: 'test-agent' });
    //     expect(session).toBeDefined();
    //     expect(session.summary).toBeNull();

    //     // Create first run (this triggers the webhook job which handles summary generation)
    //     await av.createRun({
    //       sessionId: session.id,
    //       version: '1.0.0',
    //       items: [
    //         { type: 'message', content: 'Hello, I need help with the weather!' },
    //         { type: 'output', content: 'I can help you with weather information!' }
    //       ],
    //       status: 'completed'
    //     });

    //     // Wait for the worker to process the job (worker runs every 5 seconds)
    //     await new Promise(r => setTimeout(r, 7000));

    //     // Fetch session again and verify summary is still null (because disableSummaries=true)
    //     const updatedSession = await av.getSession({ id: session.id });
    //     expect(updatedSession.summary).toBeNull();
    //   }, 15000);
    // });

    describe("watchSession", () => {
      test("yields session.snapshot for completed session then ends", async () => {
        await updateConfig();
        const session = await createSession();

        // Create and complete a run
        const run = await av.createManualRun({
          sessionId: session.id,
          items: [baseInput, baseOutput],
          status: "completed"
        });

        // Watch the session - should get snapshot and complete immediately
        const stream = await av.getSessionStream({ id: session.id });

        expect(stream).toBeNull();


        // const events: Array<{ event: SessionStreamEvent; session: StandardSession }> = [];
        // for await (const e of av.watchSession({ id: session.id })) {
        //   events.push(e);
        // }

        // // Should get exactly 1 event
        // expect(events.length).toBe(1);

        // // Check event shape
        // const event = events[0].event;
        // expect(event.type).toBe("session.snapshot");
        // expect(event.data).toBeDefined();
        // expect(event.data.id).toBe(session.id);
        // expect(event.data.runs).toBeDefined();
        // expect(event.data.runs.length).toBe(1);
        // expect(event.data.runs[0].id).toBe(run.id);

        // // Check session state
        // expect(events[0].session.id).toBe(session.id);
        // expect(events[0].session.runs.length).toBe(1);
        // expect(events[0].session.runs[0].status).toBe("completed");
      });

      test("streams run.updated events as items are added", async () => {
        await updateConfig();
        const session = await createSession();

        // Create run with input (in_progress)
        const run = await av.createManualRun({
          sessionId: session.id,
          items: [baseInput],
        });
        expect(run.status).toBe("in_progress");

        // Collect events in background
        const events: Array<{ event: SessionStreamEvent; session: StandardSession }> = [];
        const abortController = new AbortController();

        const watchPromise = (async () => {
          const stream = await av.getSessionStream({ id: session.id, signal: abortController.signal });
          if (!stream) {
            throw new Error('Stream is null');
          }

          for await (const e of stream) {
            events.push(e);
            // Stop after we get the completed status
            if (e.session.runs[0]?.status === "completed") {
              break;
            }
          }
        })();

        // Give watch a moment to start
        await new Promise(r => setTimeout(r, 500));

        // Add step and output, then complete
        await av.updateManualRun({
          id: run.id,
          items: [baseStep],
        });

        await new Promise(r => setTimeout(r, 500));

        await av.updateManualRun({
          id: run.id,
          items: [baseOutput],
          status: "completed"
        });

        // Wait for watch to complete
        await watchPromise;

        // Should get at least 2 events: snapshot + at least one run.updated
        expect(events.length).toBeGreaterThanOrEqual(2);

        // First event should be session.snapshot
        expect(events[0].event.type).toBe("session.snapshot");
        expect(events[0].event.data.id).toBe(session.id);
        expect(events[0].event.data.runs[0].sessionItems.length).toBe(1); // just input

        // Subsequent events should be run.patch
        const updateEvents = events.slice(1);
        for (const e of updateEvents) {
          expect(e.event.type).toBe("run.patch");
        }

        // Final session state should have all items
        const finalSession = events[events.length - 1].session;
        expect(finalSession.runs[0].status).toBe("completed");
        expect(finalSession.runs[0].sessionItems.length).toBe(3); // input, step, output
      }, 15000);

      test("can be aborted via AbortSignal", async () => {
        await updateConfig();
        const session = await createSession();

        // Create run (in_progress)
        await av.createManualRun({
          sessionId: session.id,
          items: [baseInput],
        });

        const abortController = new AbortController();
        const events: Array<{ event: SessionStreamEvent; session: StandardSession }> = [];

        const watchPromise = (async () => {
          try {
            const stream = await av.getSessionStream({ id: session.id, signal: abortController.signal });
            if (!stream) {
              throw new Error('Stream is null');
            }

            for await (const e of stream) {
              events.push(e);
              // Abort after first event
              if (events.length === 1) {
                abortController.abort();
              }
            }
          } catch (err: any) {
            if (err?.name === 'AbortError') {
              return 'aborted';
            }
            throw err;
          }
          return 'completed';
        })();

        const result = await watchPromise;

        // Should have gotten exactly 1 event (snapshot) before abort
        expect(events.length).toBe(1);
        expect(events[0].event.type).toBe("session.snapshot");
        expect(events[0].event.data).toBeDefined();
        expect(result).toBe('aborted');
      }, 10000);
    });
  });


  describe('Multi-Tenancy isolation', () => {
    let orgAApiKey: string;
    let orgBApiKey: string;
    let av_a: StandardAgentViewClient;
    let av_b: StandardAgentViewClient;

    beforeAll(async () => {
      // Create two separate organizations
      const orgASlug = "orga-" + Math.random().toString(36).slice(2);
      const orgBSlug = "orgb-" + Math.random().toString(36).slice(2);

      console.log("Creating orgA:", orgASlug);
      console.log("Creating orgB:", orgBSlug);

      const { apiKeySecret: apiKey1 } = await seedUsers(orgASlug);
      const { apiKeySecret: apiKey2 } = await seedUsers(orgBSlug);

      orgAApiKey = apiKey1.key;
      orgBApiKey = apiKey2.key;

      av_a = createStandardClient({ apiKey: orgAApiKey, env: 'production' });
      av_b = createStandardClient({ apiKey: orgBApiKey, env: 'production' });

      const config = {
        agents: [{
          name: 'test-agent',
          version: '1.0.0',
          runs: [{
            input: { schema: z.looseObject({ type: z.literal("message"), content: z.string() }) },
            output: [{ schema: z.looseObject({ type: z.literal("output"), content: z.string() }) }],
          }]
        }],
        channels: [{ type: 'api' as const, name: 'test-agent', agent: 'test-agent' }]
      };

      // Set up config for both orgs
      await updateEnvironment(av_a, { config });
      await updateEnvironment(av_b, { config });
    });

    test('org_a cannot see org_b users', async () => {
      // Create a user in org2
      const { user: user_a } = await av_a.users.create();
      expect(user_a).toBeDefined();
      expect(user_a.id).toBeDefined();

      // Try to get that user from org1 - should fail with 404
      await expect(av_b.users.get(user_a.id)).rejects.toThrow();
    });

    test('org_a cannot see org_a sessions', async () => {
      // Create a user and session in org2
      const { user: user_b } = await av_b.users.create();
      const session_b = await av_b.createSession({ userId: user_b.id, agent: 'test-agent' });
      expect(session_b).toBeDefined();

      // Try to get that session from org1 - should fail with 404
      // await expect(av_a.getSession({ id: session_b.id })).rejects.toThrow();
    });

    test('listing sessions only returns own org data', async () => {
      // Create users and sessions in both orgs
      const{ user: user_a } = await av_a.users.create();
      const{ user: user_b } = await av_b.users.create();

      const session_a = await av_a.createSession({ userId: user_a.id, agent: 'test-agent' });
      const session_b = await av_b.createSession({ userId: user_b.id, agent: 'test-agent' });

      // List sessions from org1
      const sessions_a = await av_a.getSessions({ space: 'production' });

      // Should contain org1's session
      expect(sessions_a.sessions.some(s => s.id === session_a.id)).toBe(true);

      // Should NOT contain org2's session
      expect(sessions_a.sessions.some(s => s.id === session_b.id)).toBe(false);
    });

    test('org1 cannot modify org2 resources', async () => {
      // Create a session in org2 with a run
      const { user: user_b } = await av_b.users.create();
      const session_b = await av_b.createSession({ userId: user_b.id, agent: 'test-agent' });

      const run_b = await av_b.createManualRun({
        sessionId: session_b.id,
        items: [{ type: 'message', content: 'hello' }],
        status: 'in_progress'
      });

      // Try to update the run from org1 - should fail
      await expect(av_a.updateManualRun({
        id: run_b.id,
        status: 'completed',
        items: [{ type: 'output', content: 'response' }]
      })).rejects.toThrow();
    });
  });




  /** Quick JSON.parse-based deep compare, ignores order of keys in objects */
  function deepCompare(a: any, b: any): boolean {
    // simple primitives and types
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return a === b;

    // arrays
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!deepCompare(a[i], b[i])) return false;
      }
      return true;
    }

    // plain objects
    if (typeof a === "object" && typeof b === "object") {
      const aKeys = Object.keys(a);
      const bKeys = Object.keys(b);
      if (aKeys.length !== bKeys.length) return false;
      for (const key of aKeys) {
        if (!bKeys.includes(key)) return false;
        if (!deepCompare(a[key], b[key])) return false;
      }
      return true;
    }

    // fallback
    return false;
  }


  function removeDoubleUnderscoreKeys(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(removeDoubleUnderscoreKeys);
    } else if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const key of Object.keys(obj)) {
        if (!key.startsWith('__')) {
          result[key] = removeDoubleUnderscoreKeys(obj[key]);
        }
      }
      return result;
    }
    return obj;
  }


  /**
   * Agent Endpoint Auto-Fetch tests.
   * Tests the auto-fetch flow where an agent with a `url` in its config
   * gets called automatically by the worker upon run creation.
   */

  // describe.only("agent endpoint auto-fetch", () => {
  //   const AGENT_PORT = 3457;
  //   const AGENT_URL = `http://localhost:${AGENT_PORT}/agent`;

  //   let mockAgentServer: MockServer | null = null;

  //   const updateConfigWithUrl = async () => {
  //     const inputSchema = z.looseObject({ type: z.literal("message"), role: z.literal("user"), content: z.string() });
  //     const outputSchema = z.looseObject({ type: z.literal("message"), role: z.literal("assistant"), content: z.string() });
  //     const stepSchema = z.looseObject({ type: z.literal("reasoning"), content: z.string() });

  //     await updateEnvironment(av, {
  //       config: {
  //         agents: [{
  //           name: "test",
  //           version: "1.0.0",
  //           url: AGENT_URL,
  //           runs: [{
  //             input: { schema: inputSchema },
  //             steps: [{ schema: stepSchema }],
  //             output: { schema: outputSchema },
  //           }]
  //         }],
  //         channels: [{ type: 'api', name: "test", agent: "test" }],
  //       },
  //     });
  //   };


  //   async function collectSessionStream(stream: Awaited<ReturnType<typeof av.getSessionStream>>) {
  //     const streamEvents: Array<{ event: SessionStreamEvent; session: StandardSession }> = [];
  //     for await (const e of stream!) {
  //       streamEvents.push(e);
  //     }

  //     const finalSession = streamEvents[streamEvents.length - 1]?.session;
  //     const finalRun = finalSession?.runs[finalSession.runs.length - 1];

  //     return { 
  //       streamEvents,
  //       finalSession,
  //       finalRun,
  //     };
  //   }


  //   beforeAll(async () => {
  //     mockAgentServer = await createMockServer(AGENT_PORT);
  //   });

  //   afterAll(async () => {
  //     if (mockAgentServer) {
  //       await mockAgentServer.close();
  //       mockAgentServer = null;
  //     }
  //   }, 10000);

  //   beforeEach(() => {
  //     mockAgentServer?.resetRequests();
  //   });

  //   test("happy path: agent streams run.patch events (validated via session stream)", async () => {
  //     await updateConfigWithUrl();
  //     const session = await av.createSession({ agent: "test", userId: initUser1.id});

  //     mockAgentServer!.setHandler((_body, res) => {
  //       writeSSE(res, [
  //         { event: "run.patch", data: { items: [{ type: "reasoning", content: "Thinking..." }] } },
  //         { event: "run.patch", data: { items: [{ type: "message", role: "assistant", content: "Hello!" }], status: "completed" } },
  //       ]);
  //     });

  //     const run = await av.createRun({
  //       sessionId: session.id,
  //       input: { type: "message", role: "user", content: "Hi" },
  //     });

  //     expect(run.status).toBe("in_progress");
  //     expect(run.agentRef).toMatchObject({
  //       version: "1.0.0",
  //       agent: "test",
  //       adapter: "agentview",
  //     });

  //     // Watch the session stream instead of polling
  //     const stream = await av.getSessionStream({ id: session.id });
  //     expect(stream).not.toBeNull();

  //     const { streamEvents, finalSession, finalRun } = await collectSessionStream(stream)

  //     // Validate stream events
  //     expect(streamEvents.length).toBeGreaterThanOrEqual(2);
  //     expect(streamEvents[0].event.type).toBe("session.snapshot");

  //     const patchEvents = streamEvents.filter(e => e.event.type === "run.patch");
  //     expect(patchEvents.length).toBeGreaterThanOrEqual(1);

  //     // Validate final session state from the stream
  //     expect(finalRun.status).toBe("completed");
  //     expect(finalRun.agentRef?.version).toBe("1.0.0");
  //     expect(finalRun.sessionItems.length).toBe(3);
  //     expect(finalRun.sessionItems[0].content.type).toBe("message");
  //     expect(finalRun.sessionItems[0].content.role).toBe("user");
  //     expect(finalRun.sessionItems[1].content.type).toBe("reasoning");
  //     expect(finalRun.sessionItems[2].content.type).toBe("message");
  //     expect(finalRun.sessionItems[2].content.role).toBe("assistant");

  //     // Verify the agent received the session
  //     expect(mockAgentServer!.requests.length).toBeGreaterThanOrEqual(1);
  //     const agentRequest = mockAgentServer!.requests[0];
  //     expect(agentRequest.body.session).toBeDefined();
  //     expect(agentRequest.body.session.id).toBe(session.id);
  //   }, 10000);

  //   test("PATCH blocked: PATCH with items while fetchStatus active → 422", async () => {
  //     await updateConfigWithUrl();
  //     const session = await av.createSession({ agent: "test", userId: initUser1.id});

  //     // Set up a slow handler so the run stays in fetching state
  //     mockAgentServer!.setHandler((_body, res) => {
  //       res.writeHead(200, {
  //         'Content-Type': 'text/event-stream',
  //         'Cache-Control': 'no-cache',
  //       });
  //       // Keep the stream open - don't end it
  //       // The cancellation below will cause the worker to abort
  //     });

  //     const run = await av.createRun({
  //       sessionId: session.id,
  //       input: { type: "message", role: "user", content: "Hi" },
  //     });

  //     // Try to patch with items - should fail
  //     await expectToFail(av.updateManualRun({
  //       id: run.id,
  //       items: [{ type: "reasoning", content: "Thinking..." }],
  //     }), 422);

  //     // Cancel the run to clean up
  //     const cancelled = await av.cancelRun({ sessionId: session.id });
  //     expect(cancelled.lastRun?.status).toBe("cancelled");
  //   }, 10000);


  //   test("cancellation → succeeds and aborts connection", async () => {
  //     await updateConfigWithUrl();
  //     const session = await av.createSession({ agent: "test", userId: initUser1.id});

  //     // Track whether the connection was closed, and when it's connected
  //     let connectionClosed = false;
  //     let connectionEstablished: () => void;
  //     const connectionEstablishedPromise = new Promise<void>(r => { connectionEstablished = r; });

  //     mockAgentServer!.setHandler((_body, res) => {
  //       res.writeHead(200, {
  //         'Content-Type': 'text/event-stream',
  //         'Cache-Control': 'no-cache',
  //       });
  //       connectionEstablished();
  //       // Send periodic keepalive events so the worker can detect cancellation
  //       const keepalive = setInterval(() => {
  //         if (!res.closed) {
  //           res.write(`event: keepalive\ndata: {}\n\n`);
  //         }
  //       }, 500);
  //       res.on('close', () => {
  //         clearInterval(keepalive);
  //         connectionClosed = true;
  //       });
  //     });

  //     const run = await av.createRun({
  //       sessionId: session.id,
  //       input: { type: "message", role: "user", content: "Hi" },
  //     });

  //     // Wait for the worker to actually connect to the mock agent before cancelling
  //     await connectionEstablishedPromise;

  //     // Cancel the run
  //     const cancelled = await av.cancelRun({ sessionId: session.id });
  //     expect(cancelled.lastRun?.status).toBe("cancelled");
  //     expect(cancelled.lastRun?.finishedAt).toBeDefined();

  //     // Wait for the worker to detect cancellation on the next event and abort
  //     await new Promise(r => setTimeout(r, 3000));
  //     expect(connectionClosed).toBe(true);
  //   }, 10000);

  //   test("error event: agent sends event: error → run marked failed", async () => {
  //     await updateConfigWithUrl();
  //     const session = await av.createSession({ agent: "test", userId: initUser1.id});

  //     mockAgentServer!.setHandler((_body, res) => {
  //       writeSSE(res, [
  //         { event: "error", data: { message: "Something went wrong" } },
  //       ]);
  //     });

  //     const run = await av.createRun({
  //       sessionId: session.id,
  //       input: { type: "message", role: "user", content: "Hi" },
  //     });

  //     const stream = await av.getSessionStream({ id: session.id });
  //     expect(stream).not.toBeNull();

  //     const { finalRun } = await collectSessionStream(stream)
  //     expect(finalRun.status).toBe("failed");
  //     expect(finalRun.failReason).toBeDefined();
  //   }, 10000);

  //   test("bad HTTP response: agent returns 500 → run marked failed", async () => {
  //     await updateConfigWithUrl();
  //     const session = await av.createSession({ agent: "test", userId: initUser1.id});

  //     mockAgentServer!.setHandler((_body, res) => {
  //       res.writeHead(500, { 'Content-Type': 'application/json' });
  //       res.end(JSON.stringify({ message: "Internal Server Error" }));
  //     });

  //     const run = await av.createRun({
  //       sessionId: session.id,
  //       input: { type: "message", role: "user", content: "Hi" },
  //     });

  //     const stream = await av.getSessionStream({ id: session.id });
  //     expect(stream).not.toBeNull();
  //     const { finalRun } = await collectSessionStream(stream)

  //     expect(finalRun.status).toBe("failed");
  //     expect(finalRun.failReason).toBeDefined();
  //   }, 10000);

  //   test("stream ends without completion → run fails", async () => {
  //     await updateConfigWithUrl();
  //     const session = await av.createSession({ agent: "test", userId: initUser1.id});

  //     mockAgentServer!.setHandler((_body, res) => {
  //       writeSSE(res, [
  //         { event: "run.patch", data: { items: [{ type: "reasoning", content: "Thinking..." }] } },
  //         // Stream ends without completing (no status: 'completed')
  //       ]);
  //     });

  //     const run = await av.createRun({
  //       sessionId: session.id,
  //       input: { type: "message", role: "user", content: "Hi" },
  //     });

  //     const stream = await av.getSessionStream({ id: session.id });
  //     expect(stream).not.toBeNull();
  //     const { finalRun } = await collectSessionStream(stream)

  //     expect(finalRun.status).toBe("failed");
  //     expect(finalRun.failReason.message).toContain("Agent stream ended without completing");
  //   }, 10000);

  //   test("multiple incremental patches: items accumulate correctly (validated via session stream)", async () => {
  //     await updateConfigWithUrl();
  //     const session = await av.createSession({ agent: "test", userId: initUser1.id});

  //     mockAgentServer!.setHandler((_body, res) => {
  //       writeSSE(res, [
  //         { event: "run.patch", data: { items: [{ type: "reasoning", content: "Step 1" }] } },
  //         { event: "run.patch", data: { items: [{ type: "reasoning", content: "Step 2" }] } },
  //         { event: "run.patch", data: { items: [{ type: "reasoning", content: "Step 3" }] } },
  //         { event: "run.patch", data: { items: [{ type: "message", role: "assistant", content: "Final" }], status: "completed" } },
  //       ]);
  //     });

  //     await av.createRun({
  //       sessionId: session.id,
  //       input: { type: "message", role: "user", content: "Hi" },
  //     });

  //     // Watch the session stream
  //     const stream = await av.getSessionStream({ id: session.id });
  //     expect(stream).not.toBeNull();

  //     const { streamEvents, finalRun } = await collectSessionStream(stream)

  //     // Validate we got multiple run.patch events (one per patch from the agent)
  //     const patchEvents = streamEvents.filter(e => e.event.type === "run.patch");
  //     expect(patchEvents.length).toBeGreaterThanOrEqual(4); // 3 steps + 1 completion

  //     // Validate final state from the stream
  //     expect(finalRun.status).toBe("completed");
  //     expect(finalRun.sessionItems.length).toBe(5);
  //     expect(finalRun.sessionItems[1].content.content).toBe("Step 1");
  //     expect(finalRun.sessionItems[2].content.content).toBe("Step 2");
  //     expect(finalRun.sessionItems[3].content.content).toBe("Step 3");
  //     expect(finalRun.sessionItems[4].content.content).toBe("Final");
  //   }, 10000);

  // });


  describe("comments and scores (flat API)", () => {

    test("create, edit, delete comment on session item", async () => {
      await updateConfig({
        itemScores: [{ name: "quality", schema: z.enum(["good", "bad"]) }],
      });

      const session = await createSession();
      const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] });
      await av.updateManualRun({ id: run.id, items: [baseOutput], status: "completed" });

      const updatedSession = await av.getSession({ id: session.id });
      const outputItem = updatedSession.runs[0].sessionItems.find(i => i.type === "output")!;

      // Create comment on session item
      await av.comments.create({ sessionItemId: outputItem.id, content: "Great output!" });

      // Verify comment appears in session comments
      let comments = await av.comments.list({ sessionId: session.id });
      expect(comments.length).toBe(1);
      expect(comments[0].content).toBe("Great output!");
      expect(comments[0].sessionItemId).toBe(outputItem.id);
      expect(comments[0].sessionItemIndex).toBe(1); // output is 2nd item (index 1)
      expect(comments[0].runId).toBe(run.id);
      expect(comments[0].sessionId).toBe(session.id);
      expect(comments[0].channelMessageId).toBeNull();

      const commentId = comments[0].id;

      // Edit comment
      await av.comments.update(commentId, { content: "Updated comment!" });

      comments = await av.comments.list({ sessionId: session.id });
      expect(comments.length).toBe(1);
      expect(comments[0].content).toBe("Updated comment!");

      // Delete comment
      await av.comments.delete(commentId);

      comments = await av.comments.list({ sessionId: session.id });
      // Deleted comments should not appear in listing
      expect(comments.length).toBe(0);
    });

    test("create comment on run", async () => {
      await updateConfig();

      const session = await createSession();
      const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] });

      // Create comment on run
      await av.comments.create({ runId: run.id, content: "Run comment" });

      // Verify comment appears in session comments
      const comments = await av.comments.list({ sessionId: session.id });
      const runComment = comments.find(c => c.runId === run.id);
      expect(runComment).toBeDefined();
      expect(runComment!.content).toBe("Run comment");
      expect(runComment!.sessionItemId).toBeNull();
      expect(runComment!.sessionItemIndex).toBeNull();
    });

    test("incorrect target throws", async () => {
      await updateConfig();

      const session = await createSession();
      const run = await av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed" });
      const run2 = await av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed" });

      
      // No target
      await expectToFail(
        av.comments.create({ content: "no target" } as any),
        400
      );

      // Two targets
      const updatedSession = await av.getSession({ id: session.id });
      const inputItem = updatedSession.runs[0].sessionItems.find(i => i.type === "input")!;

      await expectToFail(
        av.comments.create({ sessionItemId: inputItem.id, runId: run2.id, content: "incompatible session item and run item" }),
        400
      );
    });

    test("scores on session item", async () => {
      await updateConfig({
        itemScores: [{ name: "quality", schema: z.enum(["good", "bad"]) }],
      });

      const session = await createSession();
      const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] });
      await av.updateManualRun({ id: run.id, items: [baseOutput], status: "completed" });

      const updatedSession = await av.getSession({ id: session.id });
      const outputItem = updatedSession.runs[0].sessionItems.find(i => i.type === "output")!;

      // Create score
      await av.scores.update({ sessionItemId: outputItem.id, scores: [{ name: "quality", value: "good" }] });

      // Verify score appears in session scores
      let sessionScores = await av.scores.list({ sessionId: session.id });
      expect(sessionScores.length).toBe(1);
      expect(sessionScores[0].name).toBe("quality");
      expect(sessionScores[0].value).toBe("good");
      expect(sessionScores[0].sessionId).toBe(session.id);
      expect(sessionScores[0].sessionItemId).toBe(outputItem.id);
      expect(sessionScores[0].runId).toBe(run.id);

      // Update score
      await av.scores.update({ sessionItemId: outputItem.id, scores: [{ name: "quality", value: "bad" }] });

      sessionScores = await av.scores.list({ sessionId: session.id });
      expect(sessionScores.length).toBe(1);
      expect(sessionScores[0].value).toBe("bad");

      // Delete score (set to null)
      await av.scores.update({ sessionItemId: outputItem.id, scores: [{ name: "quality", value: null }] });

      sessionScores = await av.scores.list({ sessionId: session.id });
      expect(sessionScores.length).toBe(0);
    });

    test("scores on run", async () => {
      await updateConfig({
        runScores: [{ name: "accuracy", schema: z.number().min(0).max(1) }],
      });

      const session = await createSession();
      const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] });

      // Create run-level score
      await av.scores.update({ runId: run.id, scores: [{ name: "accuracy", value: 0.95 }] });

      // Verify score appears in session scores
      let sessionScores = await av.scores.list({ sessionId: session.id });
      expect(sessionScores.length).toBe(1);
      expect(sessionScores[0].name).toBe("accuracy");
      expect(sessionScores[0].value).toBe(0.95);
      expect(sessionScores[0].runId).toBe(run.id);
      expect(sessionScores[0].sessionItemId).toBeNull();

      // Update run-level score
      await av.scores.update({ runId: run.id, scores: [{ name: "accuracy", value: 0.5 }] });

      sessionScores = await av.scores.list({ sessionId: session.id });
      expect(sessionScores.length).toBe(1);
      expect(sessionScores[0].value).toBe(0.5);
    });

    // test("must provide exactly one target for scores", async () => {
    //   await updateConfig({
    //     itemScores: [{ name: "quality", schema: z.enum(["good", "bad"]) }],
    //     runScores: [{ name: "accuracy", schema: z.number() }],
    //   });

    //   const session = await createSession();
    //   const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] });

    //   // No target
    //   await expectToFail(
    //     av.updateScores({ scores: [{ name: "quality", value: "good" }] } as any),
    //     422
    //   );
    // });

    test("invalid score name is rejected", async () => {
      await updateConfig({
        itemScores: [{ name: "quality", schema: z.enum(["good", "bad"]) }],
      });

      const session = await createSession();
      const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] });
      await av.updateManualRun({ id: run.id, items: [baseOutput], status: "completed" });

      const updatedSession = await av.getSession({ id: session.id });
      const outputItem = updatedSession.runs[0].sessionItems.find(i => i.type === "output")!;

      // Unknown score name
      await expectToFail(
        av.scores.update({ sessionItemId: outputItem.id, scores: [{ name: "unknown", value: "good" }] }),
        400
      );
    });

    test("invalid score value is rejected", async () => {
      await updateConfig({
        itemScores: [{ name: "quality", schema: z.enum(["good", "bad"]) }],
      });

      const session = await createSession();
      const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] });
      await av.updateManualRun({ id: run.id, items: [baseOutput], status: "completed" });

      const updatedSession = await av.getSession({ id: session.id });
      const outputItem = updatedSession.runs[0].sessionItems.find(i => i.type === "output")!;

      // Invalid value for enum
      await expectToFail(
        av.scores.update({ sessionItemId: outputItem.id, scores: [{ name: "quality", value: "invalid" }] }),
        400
      );
    });

    test("target session item by index", async () => {
      await updateConfig({
        itemScores: [{ name: "quality", schema: z.enum(["good", "bad"]) }],
      });

      const session = await createSession();
      const run = await av.createManualRun({ sessionId: session.id, items: [baseInput] });
      await av.updateManualRun({ id: run.id, items: [baseOutput], status: "completed" });

      const updatedSession = await av.getSession({ id: session.id });
      const items = updatedSession.runs[0].sessionItems;
      const inputItem = items.find(i => i.type === "input")!;
      const outputItem = items.find(i => i.type === "output")!;

      // Comment on item by index 0 (input)
      await av.comments.create({ runId: run.id, sessionItemIndex: 0, content: "Comment on input" });

      let comments = await av.comments.list({ sessionId: session.id });
      expect(comments.length).toBe(1);
      expect(comments[0].sessionItemId).toBe(inputItem.id);
      expect(comments[0].sessionItemIndex).toBe(0);

      // Score on item by index 1 (output)
      await av.scores.update({ runId: run.id, sessionItemIndex: 1, scores: [{ name: "quality", value: "good" }] });

      const sessionScores = await av.scores.list({ sessionId: session.id });
      expect(sessionScores.length).toBe(1);
      expect(sessionScores[0].sessionItemId).toBe(outputItem.id);
      expect(sessionScores[0].sessionItemIndex).toBe(1);
    });

    test("sessionItemIndex error cases", async () => {
      await updateConfig();

      const session = await createSession();
      const run = await av.createManualRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed" });

      const updatedSession = await av.getSession({ id: session.id });
      const inputItem = updatedSession.runs[0].sessionItems.find(i => i.type === "input")!;

      // Both sessionItemId and sessionItemIndex
      await expectToFail(
        av.comments.create({ sessionItemId: inputItem.id, sessionItemIndex: 0, runId: run.id, content: "both" }),
        400
      );

      // sessionItemIndex without runId
      await expectToFail(
        av.comments.create({ sessionItemIndex: 0, content: "no run" }),
        400
      );

      // Out of bounds index
      await expectToFail(
        av.comments.create({ runId: run.id, sessionItemIndex: 999, content: "oob" }),
        404
      );
    });

  });


});