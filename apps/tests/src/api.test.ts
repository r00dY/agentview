import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { AgentView, PublicAgentView, configDefaults } from 'agentview'
import type { User, Run, Session, SessionStreamEvent } from 'agentview';
import { z } from 'zod';
import { seedUsers } from './seedUsers';
import { createTestAuthClient } from './authClient';
import { createMockServer, writeSSE, writeAISDKStream } from './mockServer';
import type { MockServer, SSEEvent } from './mockServer';

// globally disable summaries for all tests
configDefaults.__internal = {
  disableSummaries: true,
}

describe('API', () => {
  let initUser1: User
  let initUser2: User

  let initProdUser: User

  const EXTERNAL_ID_1 = 'external-id-1'
  const EXTERNAL_ID_2 = 'external-id-2'
  const EXTERNAL_PROD_ID_1 = 'external-prod-id-1'

  let av: AgentView;
  let avProd: AgentView;
  let orgSlug: string;
  let organization: { id: string };
  let adminUser: { id: string; email: string; name: string; }; // matches shape of adminUser returned by seedUsers

  beforeAll(async () => {
    orgSlug = "test-" + Math.random().toString(36).slice(2);
    console.log("Seeding users for org: ", orgSlug);

    const result = await seedUsers(orgSlug);
    organization = result.organization;
    adminUser = result.adminUser;

    av = new AgentView({
      apiKey: result.apiKeyDev.key,
    })

    avProd = new AgentView({
      apiKey: result.apiKeyProd.key,
    })

    initUser1 = await av.createUser({ externalId: EXTERNAL_ID_1 })
    initUser2 = await av.createUser({ externalId: EXTERNAL_ID_2 })
    initProdUser = await avProd.createUser({ externalId: EXTERNAL_PROD_ID_1, space: "production" })

    expect(initUser1).toBeDefined()
    expect(initUser1.externalId).toBe(EXTERNAL_ID_1)
    expect(initUser1.createdBy).toBeDefined()

    expect(initUser2).toBeDefined()
    expect(initUser2.externalId).toBe(EXTERNAL_ID_2)
    expect(initUser1.createdBy).toBeDefined()

    expect(initProdUser).toBeDefined()
    expect(initProdUser.externalId).toBe(EXTERNAL_PROD_ID_1) // external id the same as initUSer1, but in prod
    expect(initProdUser.createdBy).toBeNull()
  })

  function expectToFail(promise: Promise<any>, statusCode: number) {
    return expect(promise).rejects.toThrowError(expect.objectContaining({
      statusCode,
      message: expect.any(String),
    }))
  }

  const updateConfig = async (options: { strictMatching?: boolean, runMetadata?: Record<string, z.ZodType>, allowUnknownMetadata?: boolean, validateSteps?: boolean, prod?: boolean } = {}) => {

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
          runs: [
            {
              input: { schema: inputSchema },
              steps: [{ schema: stepSchema }, { schema: functionCallSchema, callResult: { schema: functionResultSchema } }],
              output: { schema: outputSchema },
              metadata: options.runMetadata,
              validateSteps: options.validateSteps,
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
      await avProd.updateEnvironment({ config })
    }
    else {
      await av.updateEnvironment({ config })
    }
  }

  const baseInput = { type: "message", role: "user", content: "Hello" }
  const baseOutput = { type: "message", role: "assistant", content: "Hi there" }
  const baseStep = { type: "reasoning", content: "Thinking..." }

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
    return await av.createSession({ channel: "test", userId: initUser1.id })
  }

  async function waitForRunStatus(sessionId: string, runId: string, statuses: string[], timeoutMs: number = 15000): Promise<Run> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const session = await av.getSession({ id: sessionId });
      const run = session.runs.find(r => r.id === runId);
      if (run && statuses.includes(run.status)) {
        return run;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`Timed out waiting for run ${runId} to reach status ${statuses.join('|')}`);
  }

  describe("users", () => {
    test("creating another user with the same external id should fail", async () => {
      await expect(av.createUser({ externalId: EXTERNAL_ID_1 })).rejects.toThrowError(expect.objectContaining({
        statusCode: 422,
        message: expect.any(String),
      }))
    })

    // TODO: Uncomment this when update user is implemented
    // test("update works", async () => {
    //   const EXTERNAL_ID = Math.random().toString(36).slice(2);
    //   const NEW_EXTERNAL_ID = EXTERNAL_ID + '1';

    //   const user = await av.createUser({ externalId: EXTERNAL_ID, isShared: false })
    //   let updatedUser = await av.updateUser({ id: user.id, externalId: NEW_EXTERNAL_ID, isShared: true })
    //   expect(updatedUser).toBeDefined()
    //   expect(updatedUser.externalId).toBe(NEW_EXTERNAL_ID)
    //   expect(updatedUser.isShared).toBe(true)

    //   updatedUser = await av.getUser({ id: user.id })
    //   expect(updatedUser).toBeDefined()
    //   expect(updatedUser.externalId).toBe(NEW_EXTERNAL_ID)
    //   expect(updatedUser.isShared).toBe(true)
    // })

    describe("get by id", () => {

      test("existing ids", async () => {
        const user1 = await av.getUser({ id: initUser1.id })
        expect(user1).toBeDefined()
        expect(user1.externalId).toBe(EXTERNAL_ID_1)

        const user2 = await av.getUser({ id: initUser2.id })
        expect(user2).toBeDefined()
        expect(user2.externalId).toBe(EXTERNAL_ID_2)
      })

      test("not found", async () => {
        await expect(av.getUser({ id: 'xxx' })).rejects.toThrowError(expect.objectContaining({
          statusCode: 404,
          message: expect.any(String),
        }))
      })

      test("succeeeds when scoped with own token", async () => {
        const user1 = await av.as(initUser1).getUser({ id: initUser1.id })
        expect(user1).toBeDefined()
        expect(user1.externalId).toBe(EXTERNAL_ID_1)
      })

      test("fails when scoped with another user's token", async () => {
        await expect(av.as(initUser1).getUser({ id: initUser2.id })).rejects.toThrowError(expect.objectContaining({
          statusCode: 401,
          message: expect.any(String),
        }))
      })
    })

    describe("get by external id", () => {
      test("existing external ids", async () => {
        const user1 = await av.getUser({ externalId: EXTERNAL_ID_1 })
        expect(user1).toBeDefined()
        expect(user1.externalId).toBe(EXTERNAL_ID_1)
      })

      test("not found", async () => {
        await expect(av.getUser({ externalId: 'unknown_external_id' })).rejects.toThrowError(expect.objectContaining({
          statusCode: 404,
          message: expect.any(String),
        }))
      })

      test("succeeeds when scoped with own token", async () => {
        const user1 = await av.as(initUser1).getUser({ externalId: EXTERNAL_ID_1 })
        expect(user1).toBeDefined()
        expect(user1.externalId).toBe(EXTERNAL_ID_1)
      })

      test("fails when scoped with another user's token", async () => {
        await expect(av.as(initUser2).getUser({ externalId: EXTERNAL_ID_1 })).rejects.toThrowError(expect.objectContaining({
          statusCode: 401,
          message: expect.any(String),
        }))
      })
    })

    describe("environment-related behaviour", () => {
      test("[dev api-key] default space for new user is playground and createdBy is set based on key", async () => {
        const user = await av.createUser()
        expect(user.space).toBe("playground")
        expect(user.createdBy).toBe(adminUser.id)
      })

      test("[dev api-key] shared-playground can be set, createdBy is set based on key", async () => {
        const user = await av.createUser({ space: "shared-playground" })
        expect(user.space).toBe("shared-playground")
        expect(user.createdBy).toBe(adminUser.id)
      })

      test("[dev api-key] production space is blocked", async () => {
        await expect(av.createUser({ space: "production" })).rejects.toThrowError(expect.objectContaining({
          statusCode: 401,
          message: expect.any(String),
        }))
      })

      test("[prod api-key] default space for new user is production and createdBy is null", async () => {
        const user = await avProd.createUser()
        expect(user.space).toBe("production")
        expect(user.createdBy).toBeNull()
      })

      test("[prod api-key] playground or shared-playground are not allowed with production api-key (you must be logged in as member to do it)", async () => {
        await expect(avProd.createUser({ space: "playground" })).rejects.toThrowError(expect.objectContaining({
          statusCode: 401,
          message: expect.any(String),
        }))

        await expect(avProd.createUser({ space: "shared-playground" })).rejects.toThrowError(expect.objectContaining({
          statusCode: 401,
          message: expect.any(String),
        }))
      })


      // test("[prod api-key] playground is possible only with explicit ", async () => {
      //   const user = await av.createUser({ space: "shared-playground" })
      //   expect(user.space).toBe("shared-playground")
      //   expect(user.createdBy).toBeNull()
      // })

      // test("[dev api-key] production space is blocked", async () => {
      //   await expect(av.createUser({ space: "production" })).rejects.toThrowError(expect.objectContaining({
      //     statusCode: 401,
      //     message: expect.any(String),
      //   }))
      // })
    })

    describe("get me", () => {
      test("works", async () => {
        const user1 = await av.as(initUser1).getUser()
        expect(user1).toBeDefined()
        expect(user1.externalId).toBe(EXTERNAL_ID_1)

        const user2 = await av.as(initUser2).getUser()
        expect(user2).toBeDefined()
        expect(user2.externalId).toBe(EXTERNAL_ID_2)
      })

      test("fails for bad token", async () => {
        await expect(av.as('xxx').getUser()).rejects.toThrowError(expect.objectContaining({
          statusCode: 404,
          message: expect.any(String),
        }))
      })
    })

    describe("PUBLIC API", () => {

      describe("get me", () => {

        test("works for existing users", async () => {
          const avPublic1 = new PublicAgentView({
            userToken: initUser1.token
          })
          const user1 = await avPublic1.getMe()
          expect(user1).toBeDefined()
          expect(user1.externalId).toBe(EXTERNAL_ID_1)

          const avPublic2 = new PublicAgentView({
            userToken: initUser2.token
          })
          const user2 = await avPublic2.getMe()
          expect(user2).toBeDefined()
          expect(user2.externalId).toBe(EXTERNAL_ID_2)
        })

        test("fails for unknown key", async () => {
          const avPublic1 = new PublicAgentView({
            userToken: "xxx"
          })

          await expect(avPublic1.getMe()).rejects.toThrowError(expect.objectContaining({
            statusCode: 401,
            message: expect.any(String),
          }))
        })
      })

      describe("get session by id", () => {
        test("works for own session", async () => {
          await av.updateEnvironment({ config: { agents: [{ name: "test" }], channels: [{ type: 'api', name: "test", agent: "test" }] } })
          const session = await av.createSession({ channel: "test", userId: initUser1.id})

          const avPublic1 = new PublicAgentView({
            userToken: initUser1.token
          })

          const fetchedSession = await avPublic1.getSession({ id: session.id })
          expect(fetchedSession).toMatchObject(session)
        })

        test("fails for someone else's session", async () => {
          await av.updateEnvironment({ config: { agents: [{ name: "test" }], channels: [{ type: 'api', name: "test", agent: "test" }] } })
          const session = await av.createSession({ channel: "test", userId: initUser1.id})

          const avPublic2 = new PublicAgentView({
            userToken: initUser2.token
          })

          await expect(avPublic2.getSession({ id: session.id })).rejects.toThrowError(expect.objectContaining({
            statusCode: 401,
            message: expect.any(String),
          }))
        })
      })
    })


  })



  describe("environments", () => {

    test("works", async () => {
      const CONFIG = { agents: [{ name: "test" }], __internal: { disableSummaries: true } };

      let environment = await av.updateEnvironment({ config: CONFIG })
      expect(environment.config).toEqual(CONFIG);

      environment = await av.getEnvironment();
      expect(environment.config).toEqual(CONFIG);

      const CONFIG_2 = { agents: [{ name: "test2" }], __internal: { disableSummaries: true } };

      environment = await av.updateEnvironment({ config: CONFIG_2 })
      expect(environment.config).toEqual(CONFIG_2);

      environment = await av.getEnvironment();
      expect(environment.config).toEqual(CONFIG_2);
    })

    test("non-config fields are stripped", async () => {
      const CONFIG = { agents: [], __internal: { disableSummaries: true } };
      const CONFIG_WITH_ANIMAL = { ...CONFIG, animal: "dog" };

      let environment = await av.updateEnvironment({ config: CONFIG_WITH_ANIMAL })
      expect(environment.config).toEqual(CONFIG);

      environment = await av.getEnvironment();
      expect(environment.config).toEqual(CONFIG);
    })

    test("invalid config throws", async () => {
      await expect(av.updateEnvironment({ config: { agents: 100 } })).rejects.toThrowError(expect.objectContaining({
        statusCode: 422,
        message: expect.any(String),
      }))
    })

    test("each developer has their own dev config", async () => {
      const authClient = createTestAuthClient();

      // Sign in as Bob and create his API key
      await authClient.signIn.email({ email: `bob@${orgSlug}.com`, password: "blablabla" });
      const bobApiKey = await authClient.apiKey.create({
        name: "bob-key",
        prefix: 'dev_',
        metadata: { organizationId: organization.id, env: 'dev' }
      });
      await authClient.signOut();

      // Sign in as Alice and create her API key
      await authClient.signIn.email({ email: `alice@${orgSlug}.com`, password: "blablabla" });
      const aliceApiKey = await authClient.apiKey.create({
        name: "alice-key",
        prefix: 'dev_',
        metadata: { organizationId: organization.id, env: 'dev' }
      });
      await authClient.signOut();

      const avBob = new AgentView({ apiKey: bobApiKey.key });
      const avAlice = new AgentView({ apiKey: aliceApiKey.key });

      // Bob uploads his config
      const BOB_CONFIG = { agents: [{ name: "bob-agent" }], channels: [{ type: 'api' as const, name: "bob-agent", agent: "bob-agent" }], __internal: { disableSummaries: true } };
      await avBob.updateEnvironment({ config: BOB_CONFIG });

      // Alice uploads her config
      const ALICE_CONFIG = { agents: [{ name: "alice-agent" }], channels: [{ type: 'api' as const, name: "alice-agent", agent: "alice-agent" }], __internal: { disableSummaries: true } };
      await avAlice.updateEnvironment({ config: ALICE_CONFIG });

      // Verify each developer sees only their own config
      const bobConfig = await avBob.getEnvironment();
      expect(bobConfig.config).toEqual(BOB_CONFIG);

      const aliceConfig = await avAlice.getEnvironment();
      expect(aliceConfig.config).toEqual(ALICE_CONFIG);

      // Double-check Bob's config wasn't overwritten by Alice's
      const bobConfigAgain = await avBob.getEnvironment();
      expect(bobConfigAgain.config).toEqual(BOB_CONFIG);

      // Test that configs are isolated for real operations (sessions/runs)
      // Bob can create sessions for his channel
      const bobUser = await avBob.createUser({ externalId: "bob-test-user" });
      const bobSession = await avBob.createSession({ channel: "bob-agent", userId: bobUser.id });
      expect(bobSession.agent).toBe("bob-agent");

      // Alice can create sessions for her channel
      const aliceUser = await avAlice.createUser({ externalId: "alice-test-user" });
      const aliceSession = await avAlice.createSession({ channel: "alice-agent", userId: aliceUser.id });
      expect(aliceSession.agent).toBe("alice-agent");

      // Bob cannot create sessions for Alice's channel (not in his config)
      await expect(avBob.createSession({ channel: "alice-agent", userId: bobUser.id }))
        .rejects.toThrowError(expect.objectContaining({ statusCode: 404 }));

      // Alice cannot create sessions for Bob's channel (not in her config)
      await expect(avAlice.createSession({ channel: "bob-agent", userId: aliceUser.id }))
        .rejects.toThrowError(expect.objectContaining({ statusCode: 404 }));
    })

    test("write operations for sessions or end users with dev api key fail in prod environment", async () => {
      await updateConfig()
      await updateConfig({ prod: true });

      // creating prod user allowed with prod key
      const prodUser = await avProd.createUser({ space: "production" })
      expect(prodUser).toBeDefined()

      // creating prod session allowed with prod key
      const prodSession = await avProd.createSession({ channel: "test", userId: prodUser.id })
      expect(prodSession).toBeDefined()

      // creating prod user not allowed with dev key
      await expect(av.createUser({ space: "production" })).rejects.toThrowError(expect.objectContaining({
        statusCode: 401,
        message: expect.any(String),
      }))

      // creating prod session not allowed with dev key
      await expect(av.createSession({ channel: "test", userId: prodUser.id })).rejects.toThrowError(expect.objectContaining({
        statusCode: 401,
        message: expect.any(String),
      }))
    })
  })

  describe("sessions", async () => {
    test("create for specific user", async () => {
      await av.updateEnvironment({ config: { agents: [{ name: "test" }], channels: [{ type: 'api', name: "test", agent: "test" }] } })

      const session = await av.createSession({ channel: "test", userId: initUser1.id})
      expect(session).toMatchObject({
        agent: "test",
        metadata: {},
        runs: [],
        user: {
          id: initUser1.id,
          externalId: EXTERNAL_ID_1,
          space: "playground",
          token: initUser1.token,
        }
      })
    })

    test("create for no user (creates new user)", async () => {
      await av.updateEnvironment({ config: { agents: [{ name: "test" }], channels: [{ type: 'api', name: "test", agent: "test" }] } })

      const session = await av.createSession({ channel: "test" })
      expect(session.userId).toBeDefined()

      const fetchedSession = await av.as(session.user).getSession({ id: session.id });
      expect(fetchedSession).toMatchObject(session)
    })

    test("create session for other user with 'as' -> should throw", async () => {
      await av.updateEnvironment({ config: { agents: [{ name: "test" }], channels: [{ type: 'api', name: "test", agent: "test" }] } })

      await expect(av.as(initUser1).createSession({ channel: "test", userId: initUser2.id })).rejects.toThrowError(expect.objectContaining({
        statusCode: 401,
        message: expect.any(String),
      }))

    })

    test("create - fails at wrong agent", async () => {
      await av.updateEnvironment({ config: { agents: [{ name: "test" }], channels: [{ type: 'api', name: "test", agent: "test" }] } })

      await expect(av.createSession({ channel: "wrong_channel", userId: initUser1.id })).rejects.toThrowError(expect.objectContaining({
        statusCode: 404,
        message: expect.any(String),
      }))
    })




    test("get by id for existing session", async () => {
      await av.updateEnvironment({ config: { agents: [{ name: "test" }], channels: [{ type: 'api', name: "test", agent: "test" }] } })

      const session = await av.createSession({ channel: "test", userId: initUser1.id})
      const fetchedSession = await av.getSession({ id: session.id })
      expect(fetchedSession).toMatchObject({
        agent: "test",
        metadata: {},
        runs: [],
        userId: initUser1.id,
      })
    })

    test("get by id - wrong id", async () => {
      await av.updateEnvironment({ config: { agents: [{ name: "test" }], channels: [{ type: 'api', name: "test", agent: "test" }] } })

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
      let run1 = await av.createRun({ sessionId: session.id, items: [baseInput], version: "1.0.0" })
      session = await av.getSession({ id: session.id })
      expect(session.items).toEqual([baseInput])
      expect(session.lastRun?.id).toBe(run1.id)

      run1 = await av.updateRun({ id: run1.id, items: [baseOutput], status: "completed" })
      session = await av.getSession({ id: session.id })
      expect(session.items).toEqual([baseInput, baseOutput])
      expect(session.lastRun?.id).toBe(run1.id)

      // Second run, failed, but items in the history
      let run2 = await av.createRun({ sessionId: session.id, items: [baseInput, baseStep, baseOutput], status: "failed", version: "1.0.0" })
      session = await av.getSession({ id: session.id })
      expect(session.items).toEqual([baseInput, baseOutput, baseInput, baseStep, baseOutput])
      expect(session.lastRun?.id).toBe(run2.id)

      // Retry, successful
      let run3 = await av.createRun({ sessionId: session.id, items: [baseInput, baseStep, baseOutput], status: "completed", version: "1.0.0" })
      session = await av.getSession({ id: session.id })
      expect(session.items).toEqual([baseInput, baseOutput, baseInput, baseStep, baseOutput])
      expect(session.lastRun?.id).toBe(run3.id)
    })

    test("state works properly", async () => {
      await updateConfig()

      let session = await createSession()
      expect(session.state).toBeNull();

      // First run, check 
      let run1 = await av.createRun({ sessionId: session.id, items: [baseInput], version: "1.0.0" })
      session = await av.getSession({ id: session.id })
      expect(session.state).toEqual(null)

      run1 = await av.updateRun({ id: run1.id, items: [baseOutput], status: "completed", state: { x: 1 } })
      session = await av.getSession({ id: session.id })
      expect(session.state).toEqual({ x: 1 })

      // Second run, failed
      let run2 = await av.createRun({ sessionId: session.id, items: [baseInput, baseStep, baseOutput], status: "failed", version: "1.0.0", state: { x: 2 } })
      session = await av.getSession({ id: session.id })
      expect(session.state).toEqual({ x: 2 })

      // Retry, successful
      let run3 = await av.createRun({ sessionId: session.id, items: [baseInput, baseStep, baseOutput], status: "completed", version: "1.0.0", state: { x: 3 } })
      session = await av.getSession({ id: session.id })
      expect(session.state).toEqual({ x: 3 })

      // can't change state after run is completed
      await expect(av.updateRun({ id: run3.id, state: { x: 4 } })).rejects.toThrowError(expect.objectContaining({
        statusCode: 422,
        message: expect.any(String),
      }))
    })



    // METADATA TESTS
    test("create / with known metadata / saved", async () => {
      await av.updateEnvironment({ config: { agents: [{ name: "test" }], channels: [{ type: 'api', name: "test", agent: "test", metadata: { product_id: z.string() } }] } })

      const session = await av.createSession({ channel: "test", userId: initUser1.id, metadata: { product_id: "123" } })
      expect(session).toMatchObject({
        agent: "test",
        metadata: {
          product_id: "123",
        }
      })
    })

    test("create / optional & nullable metadata / all saved as null", async () => {
      await av.updateEnvironment({ config: { agents: [{ name: "test" }], channels: [{ type: 'api', name: "test", agent: "test", metadata: { x: z.nullable(z.string()), y: z.nullable(z.number()) } }] } })

      const session = await av.createSession({ channel: "test", userId: initUser1.id })
      expect(session).toMatchObject({
        agent: "test",
        metadata: {
          x: null,
          y: null,
        }
      })
    })

    test("create / with known metadata + allowUnknownMetadata=false / saved", async () => {
      await av.updateEnvironment({ config: { agents: [{ name: "test" }], channels: [{ type: 'api', name: "test", agent: "test", metadata: { product_id: z.string() }, allowUnknownMetadata: false }] } })

      const session = await av.createSession({ channel: "test", userId: initUser1.id, metadata: { product_id: "123" } })
      expect(session).toMatchObject({
        agent: "test",
        metadata: {
          product_id: "123",
        }
      })
    })

    test("create / with unknown metadata / saved", async () => {
      await av.updateEnvironment({ config: { agents: [{ name: "test" }], channels: [{ type: 'api', name: "test", agent: "test" }] } })

      const session = await av.createSession({ channel: "test", userId: initUser1.id, metadata: { product_id: "123" } })
      expect(session).toMatchObject({
        agent: "test",
        metadata: {
          product_id: "123",
        }
      })
    })

    test("create / with unknown metadata + allowUnknownMetadata=false / failed", async () => {
      await av.updateEnvironment({ config: { agents: [{ name: "test" }], channels: [{ type: 'api', name: "test", agent: "test", allowUnknownMetadata: false }] } })

      await expect(av.createSession({ channel: "test", userId: initUser1.id, metadata: { product_id: "123" } })).rejects.toThrowError(expect.objectContaining({
        statusCode: 422,
        message: expect.any(String),
      }))
    })

    test("create / with incompatible metadata / fails", async () => {
      await av.updateEnvironment({ config: { agents: [{ name: "test" }], channels: [{ type: 'api', name: "test", agent: "test", metadata: { product_id: z.string() } }] } })

      await expect(av.createSession({ channel: "test", userId: initUser1.id, metadata: { product_id: 123 } })).rejects.toThrowError(expect.objectContaining({
        statusCode: 422,
        message: expect.any(String),
      }))
    })


    test("update metadata", async () => {
      await av.updateEnvironment({ config: { agents: [{ name: "test" }], channels: [{ type: 'api', name: "test", agent: "test", metadata: { field1: z.string(), field2: z.number() }, allowUnknownMetadata: false }] } })

      const session = await av.createSession({ channel: "test", metadata: { field1: "A", field2: 0 }, userId: initUser1.id })

      const updated = await av.updateSession({ id: session.id, metadata: { field1: "B", field2: 1 } })
      expect(updated.metadata).toEqual({ field1: "B", field2: 1 })

      const fetched = await av.getSession({ id: session.id })
      expect(fetched.metadata).toEqual({ field1: "B", field2: 1 })
    })

    test("update metadata - partial update", async () => {
      await av.updateEnvironment({ config: { agents: [{ name: "test" }], channels: [{ type: 'api', name: "test", agent: "test", metadata: { field1: z.string(), field2: z.number() }, allowUnknownMetadata: false }] } })

      const session = await av.createSession({ channel: "test", metadata: { field1: "A", field2: 0 }, userId: initUser1.id })

      const updated = await av.updateSession({ id: session.id, metadata: { field1: "B" } })
      expect(updated.metadata).toEqual({ field1: "B", field2: 0 })

      const fetched = await av.getSession({ id: session.id })
      expect(fetched.metadata).toEqual({ field1: "B", field2: 0 })
    })

    test("update metadata - make field null", async () => {
      await av.updateEnvironment({ config: { agents: [{ name: "test" }], channels: [{ type: 'api', name: "test", agent: "test", metadata: { field1: z.string(), field2: z.number().nullable() }, allowUnknownMetadata: false }] } })

      const session = await av.createSession({ channel: "test", metadata: { field1: "A", field2: 0 }, userId: initUser1.id })

      const updated = await av.updateSession({ id: session.id, metadata: { field2: null } })
      expect(updated.metadata).toEqual({ field1: "A", field2: null })

      const fetched = await av.getSession({ id: session.id })
      expect(fetched.metadata).toEqual({ field1: "A", field2: null })
    })

    test("update metadata only - validation enforced", async () => {
      await av.updateEnvironment({ config: { agents: [{ name: "test" }], channels: [{ type: 'api', name: "test", agent: "test", metadata: { product_id: z.string() }, allowUnknownMetadata: false }] } })

      const session = await av.createSession({ channel: "test", metadata: { product_id: "A" }, userId: initUser1.id })

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

      let user1Sessions: Session[] = []
      let user2Sessions: Session[] = []
      let prodUserSessions: Session[] = []

      let agentName = 'agent-for-testing-lists'

      beforeAll(async () => {
        await avProd.updateEnvironment({ config: { agents: [{ name: agentName }], channels: [{ type: 'api', name: agentName, agent: agentName }] } })

        // Create 20 sessions for testing
        user1Sessions = []
        for (let i = 0; i < USER_1_SESSIONS_COUNT; i++) {
          const session = await avProd.createSession({ channel: agentName, userId: initUser1.id })
          user1Sessions.push(session)
          await new Promise(resolve => setTimeout(resolve, 10)) // Small delay to ensure different updatedAt timestamps
        }

        user2Sessions = []
        for (let i = 0; i < USER_2_SESSIONS_COUNT; i++) {
          const session = await avProd.createSession({ channel: agentName, userId: initUser2.id })
          user2Sessions.push(session)
          await new Promise(resolve => setTimeout(resolve, 10)) // Small delay to ensure different updatedAt timestamps
        }

        prodUserSessions = []
        for (let i = 0; i < PROD_USER_SESSIONS_COUNT; i++) {
          const session = await avProd.createSession({ channel: agentName, userId: initProdUser.id })
          prodUserSessions.push(session)
          await new Promise(resolve => setTimeout(resolve, 10)) // Small delay to ensure different updatedAt timestamps
        }
      })

      test("no pagination params", async () => {
        const result = await avProd.getSessions({ agent: agentName, space: "playground" })

        expect(result.sessions).toBeDefined()
        expect(Array.isArray(result.sessions)).toBe(true)
        expect(result.sessions.length).toEqual(TOTAL_SESSIONS_COUNT)

        expect(result.pagination).toMatchObject({
          page: 1,
          totalCount: TOTAL_SESSIONS_COUNT,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        })
      })

      test("5 items per page, first page", async () => {
        const result = await avProd.getSessions({ agent: agentName, space: "playground", limit: 5, page: 1 })

        expect(result.sessions).toBeDefined()
        expect(result.sessions.length).toBe(5)
        expect(result.pagination).toBeDefined()
        expect(result.pagination.totalCount).toEqual(TOTAL_SESSIONS_COUNT)
        expect(result.pagination.page).toBe(1)
        expect(result.pagination.limit).toBe(5)
        expect(result.pagination.totalPages).toEqual(Math.ceil(TOTAL_SESSIONS_COUNT / 5))
        expect(result.pagination.hasNextPage).toBe(true)
        expect(result.pagination.hasPreviousPage).toBe(false)
      })

      test("5 items per page, second page", async () => {
        const result = await avProd.getSessions({ agent: agentName, space: "playground", limit: 5, page: 2 })

        expect(result.sessions).toBeDefined()
        expect(result.sessions.length).toBe(5)
        expect(result.pagination).toBeDefined()
        expect(result.pagination.page).toBe(2)
        expect(result.pagination.limit).toBe(5)
        expect(result.pagination.hasNextPage).toBe(true)
        expect(result.pagination.hasPreviousPage).toBe(true)
      })

      test("5 items per page, last page", async () => {
        const itemsPerPage = 5
        const lastPage = Math.ceil(TOTAL_SESSIONS_COUNT / itemsPerPage)

        const result = await avProd.getSessions({ agent: agentName, space: "playground", limit: 5, page: lastPage })

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
        const itemsPerPage = 5
        const lastPage = Math.ceil(TOTAL_SESSIONS_COUNT / itemsPerPage)

        const result = await avProd.getSessions({ agent: agentName, space: "playground", limit: 5, page: 100 })

        expect(result.sessions).toBeDefined()
        expect(result.sessions.length).toEqual(0)
        expect(result.pagination).toBeDefined()
        expect(result.pagination.page).toBe(100)
        expect(result.pagination.limit).toBe(5)
        expect(result.pagination.hasNextPage).toBe(false)
        expect(result.pagination.hasPreviousPage).toBe(true)
      })

      test("different page numbers", async () => {
        const page3 = await avProd.getSessions({ space: "playground", limit: 5, page: 3 })
        expect(page3.pagination.page).toBe(3)
        expect(page3.sessions.length).toBe(5)

        const page4 = await avProd.getSessions({ space: "playground", limit: 5, page: 4 })
        expect(page4.pagination.page).toBe(4)
        expect(page4.sessions.length).toBe(5)
      })

      test("page limit exceeds maximum (999999) should error", async () => {
        await expect(avProd.getSessions({ agent: agentName, space: "playground", limit: 999999 })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String)
        }))
      })

      test("user scoping works", async () => {
        const user1FetchedSessions = await avProd.as(initUser1).getSessions({ space: "playground", agent: agentName, limit: 10 })
        const user2FetchedSessions = await avProd.as(initUser2).getSessions({ space: "playground", agent: agentName, limit: 10 })

        expect(user1FetchedSessions.sessions.length).toBe(10)
        expect(user1FetchedSessions.sessions.every(session => session.userId === initUser1.id)).toBe(true)
        expect(user1FetchedSessions.pagination.totalCount).toBe(USER_1_SESSIONS_COUNT)

        expect(user2FetchedSessions.sessions.length).toBe(7)
        expect(user2FetchedSessions.sessions.every(session => session.userId === initUser2.id)).toBe(true)
        expect(user2FetchedSessions.pagination.totalCount).toBe(USER_2_SESSIONS_COUNT)
      })

      test("[public api] works", async () => {
        const avPublic1 = new PublicAgentView({
          userToken: initUser1.token
        })

        const user1FetchedSessions = await avPublic1.getSessions({ agent: agentName, limit: 10 })

        expect(user1FetchedSessions.sessions.length).toBe(10)
        expect(user1FetchedSessions.sessions.every(session => session.userId === initUser1.id)).toBe(true)
        expect(user1FetchedSessions.pagination.totalCount).toBe(USER_1_SESSIONS_COUNT)


        const avPublic2 = new PublicAgentView({
          userToken: initUser2.token
        })

        const user2FetchedSessions = await avPublic2.getSessions({ agent: agentName, limit: 10 })

        expect(user2FetchedSessions.sessions.length).toBe(7)
        expect(user2FetchedSessions.sessions.every(session => session.userId === initUser2.id)).toBe(true)
        expect(user2FetchedSessions.pagination.totalCount).toBe(USER_2_SESSIONS_COUNT)
      })

    })

    // describe("starred sessions", () => {
    //   let testSession1: Session
    //   let testSession2: Session
    //   const starredAgentName = 'agent-for-testing-stars';

    //   beforeAll(async () => {
    //     await av.updateEnvironment({ config: { agents: [{ name: starredAgentName }] } })
    //     testSession1 = await av.createSession({ agent: starredAgentName, userId: initUser1.id })
    //     testSession2 = await av.createSession({ agent: starredAgentName, userId: initUser1.id })
    //   })

    //   test("session is not starred by default", async () => {
    //     const result = await av.isSessionStarred(testSession1.id)
    //     expect(result.starred).toBe(false)
    //   })

    //   test("can star a session", async () => {
    //     const result = await av.starSession(testSession1.id)
    //     expect(result.starred).toBe(true)

    //     const checkResult = await av.isSessionStarred(testSession1.id)
    //     expect(checkResult.starred).toBe(true)
    //   })

    //   test("starring same session twice is idempotent", async () => {
    //     // testSession1 is already starred from previous test
    //     const result = await av.starSession(testSession1.id)
    //     expect(result.starred).toBe(true)

    //     const checkResult = await av.isSessionStarred(testSession1.id)
    //     expect(checkResult.starred).toBe(true)
    //   })

    //   test("can unstar a session", async () => {
    //     const result = await av.unstarSession(testSession1.id)
    //     expect(result.starred).toBe(false)

    //     const checkResult = await av.isSessionStarred(testSession1.id)
    //     expect(checkResult.starred).toBe(false)
    //   })

    //   test("unstarring an unstarred session is idempotent", async () => {
    //     // testSession1 is already unstarred from previous test
    //     const result = await av.unstarSession(testSession1.id)
    //     expect(result.starred).toBe(false)

    //     const checkResult = await av.isSessionStarred(testSession1.id)
    //     expect(checkResult.starred).toBe(false)
    //   })

    //   test("starred filter returns only starred sessions", async () => {
    //     // Star session1, leave session2 unstarred
    //     await av.starSession(testSession1.id)

    //     const starredSessions = await av.getSessions({ agent: starredAgentName, space: "playground", starred: true })
    //     expect(starredSessions.sessions.some(s => s.id === testSession1.id)).toBe(true)
    //     expect(starredSessions.sessions.some(s => s.id === testSession2.id)).toBe(false)

    //     // Star session2 as well
    //     await av.starSession(testSession2.id)
    //     const updatedStarredSessions = await av.getSessions({ agent: starredAgentName, space: "playground", starred: true })
    //     expect(updatedStarredSessions.sessions.some(s => s.id === testSession1.id)).toBe(true)
    //     expect(updatedStarredSessions.sessions.some(s => s.id === testSession2.id)).toBe(true)

    //     // Cleanup
    //     await av.unstarSession(testSession1.id)
    //     await av.unstarSession(testSession2.id)
    //   })

    //   test("starring non-existent session returns 404", async () => {
    //     await expect(av.starSession('00000000-0000-0000-0000-000000000000')).rejects.toThrowError(expect.objectContaining({
    //       statusCode: 404,
    //       message: expect.any(String),
    //     }))
    //   })
    // })

    //   describe("comments and scores endpoints", () => {
    //     let testSession: Session
    //     let testRun: Run
    //     const commentsAgentName = 'agent-for-testing-comments';

    //     beforeAll(async () => {
    //       await av.updateEnvironment({
    //         config: {
    //           agents: [{
    //             name: commentsAgentName,
    //             runs: [{
    //               input: { schema: z.looseObject({ type: z.literal("input") }) },
    //               output: { schema: z.looseObject({ type: z.literal("output") }) },
    //             }]
    //           }]
    //         }
    //       })
    //       testSession = await av.createSession({ agent: commentsAgentName, userId: initUser1.id })
    //       testRun = await av.createRun({
    //         sessionId: testSession.id,
    //         version: '1.0.0',
    //         items: [
    //           { type: 'input' },
    //           { type: 'output' }
    //         ],
    //         status: 'completed'
    //       })
    //       // Refresh session to get items
    //       testSession = await av.getSession({ id: testSession.id })
    //     })

    //     test("getSessionComments returns empty array for session without comments", async () => {
    //       const comments = await av.getSessionComments(testSession.id)
    //       expect(comments).toEqual([])
    //     })

    //     test("getSessionScores returns empty array for session without scores", async () => {
    //       const scores = await av.getSessionScores(testSession.id)
    //       expect(scores).toEqual([])
    //     })

    //     test("getSessionComments returns 404 for non-existent session", async () => {
    //       await expect(av.getSessionComments('00000000-0000-0000-0000-000000000000')).rejects.toThrowError(expect.objectContaining({
    //         statusCode: 404,
    //         message: expect.any(String),
    //       }))
    //     })

    //     test("getSessionScores returns 404 for non-existent session", async () => {
    //       await expect(av.getSessionScores('00000000-0000-0000-0000-000000000000')).rejects.toThrowError(expect.objectContaining({
    //         statusCode: 404,
    //         message: expect.any(String),
    //       }))
    //     })

    //     test("getSession does not include commentMessages or scores on session items", async () => {
    //       const session = await av.getSession({ id: testSession.id })
    //       // After the refactor, session items should not have commentMessages or scores
    //       for (const run of session.runs) {
    //         for (const item of run.sessionItems) {
    //           expect((item as any).commentMessages).toBeUndefined()
    //           expect((item as any).scores).toBeUndefined()
    //         }
    //       }
    //     })
    //   })
    // })


    describe("runs", () => {
      test("creating run with non-existing sessionId", async () => {
        await updateConfig()

        await expect(av.createRun({ sessionId: 'non-existing', items: [baseInput], version: "1.0.0" })).rejects.toThrowError(expect.objectContaining({
          statusCode: 404,
          message: expect.any(String),
        }))
      })

      test("updating run with non-existing run id", async () => {
        await updateConfig()

        await expect(av.updateRun({ id: 'non-existing', items: [baseOutput] })).rejects.toThrowError(expect.objectContaining({
          statusCode: 404,
          message: expect.any(String),
        }))
      })

      test("creating run without items", async () => {
        await updateConfig()
        const session = await createSession()

        await expect(av.createRun({ sessionId: session.id, items: [], version: "1.0.0" })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String),
        }))
      })

      test("new run defaults to in_progress status", async () => {
        await updateConfig()
        const session = await createSession()

        const run = await av.createRun({ sessionId: session.id, items: [baseInput], version: "1.0.0" })
        expect(run.status).toBe("in_progress")
      })

      test("cannot create new run while previous is in progress", async () => {
        await updateConfig()
        const session = await createSession()

        await av.createRun({ sessionId: session.id, items: [baseInput], version: "1.0.0" })
        await expect(av.createRun({ sessionId: session.id, items: [baseInput], version: "1.0.0" })).rejects.toThrowError(expect.objectContaining({
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

      const baseTestCases: Array<{ title: string, scenarios: any[], lastRunStatus: ("in_progress" | "completed" | "failed" | undefined)[], error?: number | null, validateSteps?: boolean, strictMatching?: boolean, only?: boolean }> = [
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
          validateSteps: true,
          error: 422,
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
          title: "input, 2 items, no output",
          scenarios: [
            [[baseInput, baseStep, baseStep]],
            [[baseInput], [baseStep], [baseStep]],
            [[baseInput], [baseStep, baseStep]],
          ],
          lastRunStatus: ["completed"],
          error: 422
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
        {
          title: "strict matching -> extra fields trimmed",
          strictMatching: true,
          scenarios: [
            [[baseInputExt, baseOutputExt]],
            [[baseInput], [baseStep, baseStep], [baseOutputExt]],
            [[baseInput, baseStep, baseStep, baseOutputExt]],
          ],
          lastRunStatus: ["completed"],
          error: null
        },
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
          error: 422
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
          title: "incorrect step item, validateSteps=false",
          scenarios: [
            [[baseInput, baseStep, wrongStep]],
            [[baseInput], [baseStep], [wrongStep]],
            [[baseInput], [baseStep, wrongStep]],
          ],
          // validateSteps: false -> default
          lastRunStatus: [undefined],
          error: null,
        },
        {
          title: "incorrect step item, validateSteps=true",
          scenarios: [
            [[baseInput, baseStep, wrongStep]],
            [[baseInput], [baseStep], [wrongStep]],
            [[baseInput], [baseStep, wrongStep]],
          ],
          validateSteps: true,
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
          validateSteps: true,
          lastRunStatus: ["completed", "failed"],
          error: null,
        },
        {
          title: "tool calls, correct call, paralell",
          scenarios: [
            [[baseInput, fun1Call("1"), fun2Call("2"), fun1Call("3"), funResult("3"), funResult("1"), funResult("2"), baseOutput]],
          ],
          validateSteps: true,
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
          validateSteps: true,
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
              await updateConfig({ strictMatching: testCase.strictMatching, validateSteps: testCase.validateSteps });

              const session = await createSession()

              let run: Run | undefined;
              let expected_history: any[] = [];

              for (const iteration of scenario) {
                const isLast = iteration === scenario[scenario.length - 1];
                const isFirst = iteration === scenario[0];

                let expectedStatus: string;
                let expectedHasFinishedAt: boolean;
                let promise: any;

                if (isFirst && isLast) {
                  promise = av.createRun({ sessionId: session.id, items: iteration, version: "1.0.0", status: lastRunStatus });
                  expectedStatus = lastRunStatus ?? "in_progress";
                  expectedHasFinishedAt = expectedStatus !== "in_progress";
                } else if (isLast) {
                  promise = av.updateRun({ id: run!.id, items: iteration, status: lastRunStatus })
                  expectedStatus = lastRunStatus ?? "in_progress";
                  expectedHasFinishedAt = expectedStatus !== "in_progress";
                } else if (isFirst) {
                  promise = av.createRun({ sessionId: session.id, items: iteration, version: "1.0.0" })
                  expectedStatus = "in_progress";
                  expectedHasFinishedAt = false;
                } else {
                  promise = av.updateRun({ id: run!.id, items: iteration })
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
                  run = await promise! as Run;
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

        const run = await av.createRun({ sessionId: session.id, items: [baseInput], version: "1.0.0" })
        const completed = await av.updateRun({ id: run.id, items: [baseOutput], status: "completed", metadata: { trace_id: "abc" } })
        expect(completed.status).toBe("completed")

        await expect(av.updateRun({ id: run.id, items: [baseStep] })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String),
        }))

        await expect(av.updateRun({ id: run.id, status: "failed" })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String),
        }))

      })

      test("failReason can be set only on failed runs", async () => {
        await updateConfig()
        const session = await createSession()

        const run = await av.createRun({ sessionId: session.id, items: [baseInput], version: "1.0.0" })

        const failReason = { message: "oops" }

        await expect(av.updateRun({ id: run.id, items: [baseStep], failReason })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String),
        }))

        await expect(av.updateRun({ id: run.id, items: [baseOutput], failReason, status: "completed" })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String),
        }))

        const updated = await av.updateRun({ id: run.id, items: [baseOutput], status: "failed", failReason })
        expect(updated.failReason).toEqual(failReason)
      })


      describe("versioning", () => {
        test("incorrect formats fail", async () => {
          await updateConfig()
          const session = await createSession()

          await expectToFail(av.createRun({ sessionId: session.id, items: [baseInput], version: "xxx" }), 422)
          await expectToFail(av.createRun({ sessionId: session.id, items: [baseInput], version: "blah.blah.blah" }), 422)

        })

        test("compatibility enforced - playground", async () => {
          await updateConfig()
          const session = await createSession()

          await av.createRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed", version: "1.2" }) // allow for partial version
          await av.createRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed", version: "1.2.3" })
          await av.createRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed", version: "1.2.4" }) // higher patch works
          await av.createRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed", version: "1.3.0" }) // higher minor works

          await expectToFail(av.createRun({ sessionId: session.id, items: [baseInput, baseOutput], version: "1.2.2" }), 422) // smaller patch fails
          await expectToFail(av.createRun({ sessionId: session.id, items: [baseInput, baseOutput], version: "2.0.0" }), 422) // different minor fails

          // suffixes
          await av.createRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed", version: "1.3.3" })
          await av.createRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed", version: "1.3.3-dev" })
          await av.createRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed", version: "1.3.3-xxx" })
          await av.createRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed", version: "1.3.4" })
          await av.createRun({ sessionId: session.id, items: [baseInput, baseOutput], status: "completed", version: "1.3.4-local" })

          await expectToFail(av.createRun({ sessionId: session.id, items: [baseInput, baseOutput], version: "1.3.3-local" }), 422) // smaller patch fails even with suffix
          await expectToFail(av.createRun({ sessionId: session.id, items: [baseInput, baseOutput], version: "1.3.3-xxx" }), 422) // smaller patch with §§different suffix fails
          await expectToFail(av.createRun({ sessionId: session.id, items: [baseInput, baseOutput], version: "2.0.0" }), 422) // different suffix fails
          await expectToFail(av.createRun({ sessionId: session.id, items: [baseInput, baseOutput], version: "2.0.0-dev" }), 422) // different suffix fails
        })

        test("no suffix in playground results in -dev suffix", async () => {
          await updateConfig()
          const session = await createSession()
          const run = await av.createRun({ sessionId: session.id, items: [baseInput, baseOutput], version: "1.3.0" })
          expect(run.version).toBe("1.3.0-dev")
        })

        test("playground suffix can be overriden", async () => {
          await updateConfig()
          const session = await createSession()
          const run = await av.createRun({ sessionId: session.id, items: [baseInput, baseOutput], version: "1.3.0-xxx" })
          expect(run.version).toBe("1.3.0-xxx")
        })

        test("no suffix in production is no suffix", async () => {
          await updateConfig({ prod: true })
          const session = await createSession()
          const run = await avProd.createRun({ sessionId: session.id, items: [baseInput, baseOutput], version: "1.3.0" })
          expect(run.version).toBe("1.3.0")
        })

        test("production can't have suffixed versions", async () => {
          await updateConfig({ prod: true })
          const session = await avProd.createSession({ channel: "test", userId: initProdUser.id })

          await expectToFail(avProd.createRun({ sessionId: session.id, items: [baseInput, baseOutput], version: "1.3.0-dev" }), 422) // production can't have suffixes
          await expectToFail(avProd.createRun({ sessionId: session.id, items: [baseInput, baseOutput], version: "1.3.1-local" }), 422) // production can't have suffixes
        })

      });

      test("userToken scoped permissions", async () => {
        await updateConfig()
        const session = await createSession()

        await expect(av.as(initUser2).createRun({ sessionId: session.id, items: [baseInput], version: "1.0.0" })).rejects.toThrowError(expect.objectContaining({
          statusCode: 401,
          message: expect.any(String),
        }))
      })

      // METADATA

      test("create / with known metadata / saved", async () => {
        await updateConfig({ runMetadata: { product_id: z.string() } })
        const session = await createSession()
        const run = await av.createRun({ sessionId: session.id, items: [baseInput], version: "1.0.0", metadata: { product_id: "123" } })

        expect(run.metadata).toMatchObject({
          product_id: "123",
        })
      })

      test("create / optional & nullable metadata / all saved as null", async () => {
        await updateConfig({ runMetadata: { x: z.nullable(z.string()), y: z.nullable(z.number()) } })

        const session = await createSession()
        const run = await av.createRun({ sessionId: session.id, items: [baseInput], version: "1.0.0", metadata: { product_id: "123" } })

        expect(run.metadata).toMatchObject({
          x: null,
          y: null,
        })
      })

      test("create / with known metadata + allowUnknownMetadata=false / saved", async () => {
        await updateConfig({ runMetadata: { product_id: z.string() }, allowUnknownMetadata: false })

        const session = await createSession()
        const run = await av.createRun({
          sessionId: session.id,
          items: [baseInput],
          version: "1.0.0",
          metadata: { product_id: "123" }
        })

        expect(run.metadata).toMatchObject({
          product_id: "123",
        })
      })

      test("create / with unknown metadata / saved", async () => {
        await updateConfig()
        const session = await createSession()
        const run = await av.createRun({
          sessionId: session.id,
          items: [baseInput],
          version: "1.0.0",
          metadata: { product_id: "123" }
        })

        expect(run.metadata).toMatchObject({
          product_id: "123",
        })
      })

      test("create / with unknown metadata + allowUnknownMetadata=false / failed", async () => {
        await updateConfig({ allowUnknownMetadata: false })

        const session = await createSession()
        await expect(av.createRun({
          sessionId: session.id,
          items: [baseInput],
          version: "1.0.0",
          metadata: { product_id: "123" }
        })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String),
        }))
      })

      test("create / with incompatible metadata / fails", async () => {
        await updateConfig({ runMetadata: { product_id: z.string() } })

        const session = await createSession()
        await expect(av.createRun({
          sessionId: session.id,
          items: [baseInput],
          version: "1.0.0",
          metadata: { product_id: 123 }
        })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String),
        }))
      })

      test("update metadata", async () => {
        await updateConfig({ runMetadata: { field1: z.string(), field2: z.number() }, allowUnknownMetadata: false })

        const session = await createSession()
        const run = await av.createRun({
          sessionId: session.id,
          items: [baseInput],
          version: "1.0.0",
          metadata: { field1: "A", field2: 0 }
        })

        const updated = await av.updateRun({ id: run.id, metadata: { field1: "B", field2: 1 } })
        expect(updated.metadata).toEqual({ field1: "B", field2: 1 })
      })

      test("update metadata - partial update", async () => {
        await updateConfig({ runMetadata: { field1: z.string(), field2: z.number() }, allowUnknownMetadata: false })

        const session = await createSession()
        const run = await av.createRun({
          sessionId: session.id,
          items: [baseInput],
          version: "1.0.0",
          metadata: { field1: "A", field2: 0 }
        })

        const updated = await av.updateRun({ id: run.id, metadata: { field1: "B" } })
        expect(updated.metadata).toEqual({ field1: "B", field2: 0 })
      })

      test("update metadata - make field null", async () => {
        await updateConfig({ runMetadata: { field1: z.string(), field2: z.number().nullable() }, allowUnknownMetadata: false })

        const session = await createSession()
        const run = await av.createRun({
          sessionId: session.id,
          items: [baseInput],
          version: "1.0.0",
          metadata: { field1: "A", field2: 0 }
        })

        const updated = await av.updateRun({ id: run.id, metadata: { field2: null } })
        expect(updated.metadata).toEqual({ field1: "A", field2: null })
      })

      test("update metadata only - validation enforced", async () => {
        await updateConfig({ runMetadata: { product_id: z.string() }, allowUnknownMetadata: false })

        const session = await createSession()
        const run = await av.createRun({
          sessionId: session.id,
          items: [baseInput],
          version: "1.0.0",
          metadata: { product_id: "A" }
        })

        await expect(av.updateRun({ id: run.id, metadata: { wrong: "x" } })).rejects.toThrowError(expect.objectContaining({
          statusCode: 422,
          message: expect.any(String),
        }))
      })

      test("metadata can be updated AFTER the run is completed", async () => {
        await updateConfig({ runMetadata: { product_id: z.string() } })
        const session = await createSession()
        let run = await av.createRun({ sessionId: session.id, items: [baseInput], version: "1.0.0", metadata: { product_id: "123" } })

        expect(run.metadata).toMatchObject({
          product_id: "123",
        })

        run = await av.updateRun({ id: run.id, items: [baseOutput], status: "completed", metadata: { product_id: "456" } })
        expect(run.metadata).toMatchObject({
          product_id: "456",
        })

        run = await av.updateRun({ id: run.id, metadata: { product_id: "789" } })
        expect(run.metadata).toMatchObject({
          product_id: "789",
        })
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
              runs: [
                {
                  input: { schema: inputSchema },
                  output: { schema: outputSchema },
                  idleTimeout,
                }
              ]
            }
          ],
          channels: [
            { type: 'api' as const, name: "test", agent: "test" }
          ]
        }

        await av.updateEnvironment({ config })
      }

      test("keepAliveRun returns expiresAt timestamp for in_progress run", async () => {
        await updateConfigWithTimeout(SHORT_TIMEOUT)
        const session = await av.createSession({ channel: "test", userId: initUser1.id})
        const run = await av.createRun({ sessionId: session.id, items: [baseInput], version: "1.0.0" })

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
        const session = await av.createSession({ channel: "test", userId: initUser1.id})
        const run = await av.createRun({
          sessionId: session.id,
          items: [baseInput, baseOutput],
          version: "1.0.0",
          status: "completed"
        })

        expect(run.status).toBe("completed")

        const result = await av.keepAliveRun({ id: run.id })
        expect(result.expiresAt).toBeNull()
      })

      test("run expires when idle timeout passes without keep-alive", async () => {
        await updateConfigWithTimeout(SHORT_TIMEOUT)
        const session = await av.createSession({ channel: "test", userId: initUser1.id})
        const run = await av.createRun({ sessionId: session.id, items: [baseInput], version: "1.0.0" })

        expect(run.status).toBe("in_progress")

        // Wait for expiration (timeout + worker interval buffer)
        // Worker runs every 5 seconds, so wait timeout + 6s to be safe
        await new Promise(resolve => setTimeout(resolve, SHORT_TIMEOUT * 2))

        const updatedSession = await av.getSession({ id: session.id })

        expect(updatedSession.lastRun).toBeDefined()
        expect(updatedSession.lastRun!.status).toBe("failed")
        expect(updatedSession.lastRun!.failReason).toMatchObject({ message: "Timeout" })
      }, 10000) // 10s timeout for this test

      test("keep-alive prevents expiration", async () => {
        await updateConfigWithTimeout(SHORT_TIMEOUT)
        const session = await av.createSession({ channel: "test", userId: initUser1.id})
        const run = await av.createRun({ sessionId: session.id, items: [baseInput], version: "1.0.0" })

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
        await updateConfigWithTimeout(SHORT_TIMEOUT)
        const session = await av.createSession({ channel: "test", userId: initUser1.id})
        const run = await av.createRun({ sessionId: session.id, items: [baseInput], version: "1.0.0" })

        expect(run.status).toBe("in_progress")

        // Wait half the timeout time, then update the run with output (should reset timer)
        await new Promise(resolve => setTimeout(resolve, SHORT_TIMEOUT / 2))
        await av.updateRun({ id: run.id, items: [baseOutput], status: "in_progress" })

        // Wait another full timeout time
        await new Promise(resolve => setTimeout(resolve, SHORT_TIMEOUT))

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

        await av.updateEnvironment({
          config: {
            webhookUrl: WEBHOOK_URL,
            agents: [{
              name: "test",
              runs: [{
                input: { schema: inputSchema },
                steps: [{ schema: stepSchema }, { schema: functionCallSchema, callResult: { schema: functionResultSchema } }],
                output: { schema: outputSchema },
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
        const session = await av.createSession({ channel: "test", userId: initUser1.id});

        const run = await av.createRun({
          sessionId: session.id,
          items: [baseInput],
          version: "1.0.0"
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
        const session = await av.createSession({ channel: "test", userId: initUser1.id});

        // Create first run
        const run1 = await av.createRun({
          sessionId: session.id,
          items: [baseInput, baseOutput],
          version: "1.0.0",
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
        const run2 = await av.createRun({
          sessionId: session.id,
          items: [baseInput, baseOutput],
          version: "1.0.0",
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
        const session = await av.createSession({ channel: "test", userId: initUser1.id});

        const run = await av.createRun({
          sessionId: session.id,
          items: [baseInput],
          version: "1.0.0"
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
        const run = await av.createRun({
          sessionId: session.id,
          items: [baseInput, baseOutput],
          version: "1.0.0",
          status: "completed"
        });

        // Watch the session - should get snapshot and complete immediately
        const stream = await av.getSessionStream({ id: session.id });

        expect(stream).toBeNull();


        // const events: Array<{ event: SessionStreamEvent; session: Session }> = [];
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
        const run = await av.createRun({
          sessionId: session.id,
          items: [baseInput],
          version: "1.0.0"
        });
        expect(run.status).toBe("in_progress");

        // Collect events in background
        const events: Array<{ event: SessionStreamEvent; session: Session }> = [];
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
        await av.updateRun({
          id: run.id,
          items: [baseStep],
        });

        await new Promise(r => setTimeout(r, 1500)); // Wait for polling interval

        await av.updateRun({
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

        // Subsequent events should be run.updated
        const updateEvents = events.slice(1);
        for (const e of updateEvents) {
          expect(e.event.type).toBe("run.updated");
          expect(e.event.data.id).toBe(run.id);
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
        await av.createRun({
          sessionId: session.id,
          items: [baseInput],
          version: "1.0.0"
        });

        const abortController = new AbortController();
        const events: Array<{ event: SessionStreamEvent; session: Session }> = [];

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
    let av_a: AgentView;
    let av_b: AgentView;

    beforeAll(async () => {
      // Create two separate organizations
      const orgASlug = "orga-" + Math.random().toString(36).slice(2);
      const orgBSlug = "orgb-" + Math.random().toString(36).slice(2);

      console.log("Creating orgA:", orgASlug);
      console.log("Creating orgB:", orgBSlug);

      const { apiKeyDev: apiKey1 } = await seedUsers(orgASlug);
      const { apiKeyDev: apiKey2 } = await seedUsers(orgBSlug);

      orgAApiKey = apiKey1.key;
      orgBApiKey = apiKey2.key;

      av_a = new AgentView({ apiKey: orgAApiKey });
      av_b = new AgentView({ apiKey: orgBApiKey });

      const config = {
        agents: [{
          name: 'test-agent',
          runs: [{
            input: { schema: z.looseObject({ type: z.literal("message"), content: z.string() }) },
            steps: [],
            output: { schema: z.looseObject({ type: z.literal("output"), content: z.string() }) },
          }]
        }],
        channels: [{ type: 'api' as const, name: 'test-agent', agent: 'test-agent' }]
      };

      // Set up config for both orgs
      await av_a.updateEnvironment({ config });
      await av_b.updateEnvironment({ config });
    });

    test('org_a cannot see org_b users', async () => {
      // Create a user in org2
      const user_a = await av_a.createUser({ space: 'playground' });
      expect(user_a).toBeDefined();
      expect(user_a.id).toBeDefined();

      // Try to get that user from org1 - should fail with 404
      await expect(av_b.getUser({ id: user_a.id })).rejects.toThrow();
    });

    test('org_a cannot see org_a sessions', async () => {
      // Create a user and session in org2
      const user_b = await av_b.createUser({ space: 'playground' });
      const session_b = await av_b.createSession({ userId: user_b.id, channel: 'test-agent' });
      expect(session_b).toBeDefined();

      // Try to get that session from org1 - should fail with 404
      // await expect(av_a.getSession({ id: session_b.id })).rejects.toThrow();
    });

    test('listing sessions only returns own org data', async () => {
      // Create users and sessions in both orgs
      const user_a = await av_a.createUser({ space: 'playground' });
      const user_b = await av_b.createUser({ space: 'playground' });

      const session_a = await av_a.createSession({ userId: user_a.id, channel: 'test-agent' });
      const session_b = await av_b.createSession({ userId: user_b.id, channel: 'test-agent' });

      // List sessions from org1
      const sessions_a = await av_a.getSessions({ space: 'playground' });

      // Should contain org1's session
      expect(sessions_a.sessions.some(s => s.id === session_a.id)).toBe(true);

      // Should NOT contain org2's session
      expect(sessions_a.sessions.some(s => s.id === session_b.id)).toBe(false);
    });

    test('org1 cannot modify org2 resources', async () => {
      // Create a session in org2 with a run
      const user_b = await av_b.createUser({ space: 'playground' });
      const session_b = await av_b.createSession({ userId: user_b.id, channel: 'test-agent' });

      const run_b = await av_b.createRun({
        sessionId: session_b.id,
        version: '1.0.0',
        items: [{ type: 'message', content: 'hello' }],
        status: 'in_progress'
      });

      // Try to update the run from org1 - should fail
      await expect(av_a.updateRun({
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
  describe("agent endpoint auto-fetch", () => {
    const AGENT_PORT = 3457;
    const AGENT_URL = `http://localhost:${AGENT_PORT}/agent`;

    let mockAgentServer: MockServer | null = null;

    const updateConfigWithUrl = async () => {
      const inputSchema = z.looseObject({ type: z.literal("message"), role: z.literal("user"), content: z.string() });
      const outputSchema = z.looseObject({ type: z.literal("message"), role: z.literal("assistant"), content: z.string() });
      const stepSchema = z.looseObject({ type: z.literal("reasoning"), content: z.string() });

      await av.updateEnvironment({
        config: {
          agents: [{
            name: "test",
            url: AGENT_URL,
            runs: [{
              input: { schema: inputSchema },
              steps: [{ schema: stepSchema }],
              output: { schema: outputSchema },
            }]
          }],
          channels: [{ type: 'api', name: "test", agent: "test" }],
        },
      });
    };

    beforeAll(async () => {
      mockAgentServer = await createMockServer(AGENT_PORT);
    });

    afterAll(async () => {
      if (mockAgentServer) {
        await mockAgentServer.close();
        mockAgentServer = null;
      }
    }, 30000);

    beforeEach(() => {
      mockAgentServer?.resetRequests();
    });

    test("happy path: agent streams run.patch events with version header", async () => {
      await updateConfigWithUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      mockAgentServer!.setHandler((_body, res) => {
        writeSSE(res, [
          { event: "run.patch", data: { items: [{ type: "reasoning", content: "Thinking..." }] } },
          { event: "run.patch", data: { items: [{ type: "message", role: "assistant", content: "Hello!" }], status: "completed" } },
        ], { version: "1.0.0" });
      });

      const run = await av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hi" }],
      });

      expect(run.status).toBe("in_progress");
      expect(run.version).toBeFalsy(); // version not set yet at creation time

      // Wait for the worker to process the run
      const completedRun = await waitForRunStatus(session.id, run.id, ["completed"]);
      expect(completedRun.status).toBe("completed");
      expect(completedRun.version).toBe("1.0.0-dev"); // dev suffix applied
      // Should have 3 items: input + step + output
      expect(completedRun.sessionItems.length).toBe(3);
      expect(completedRun.sessionItems[0].content.type).toBe("message");
      expect(completedRun.sessionItems[0].content.role).toBe("user");
      expect(completedRun.sessionItems[1].content.type).toBe("reasoning");
      expect(completedRun.sessionItems[2].content.type).toBe("message");
      expect(completedRun.sessionItems[2].content.role).toBe("assistant");

      // Verify the agent received the session
      expect(mockAgentServer!.requests.length).toBeGreaterThanOrEqual(1);
      const agentRequest = mockAgentServer!.requests[0];
      expect(agentRequest.body.session).toBeDefined();
      expect(agentRequest.body.session.id).toBe(session.id);
    }, 30000);

    test("POST validation: creating run with >1 item when url set → 422", async () => {
      await updateConfigWithUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      await expectToFail(av.createRun({
        sessionId: session.id,
        items: [
          { type: "message", role: "user", content: "Hi" },
          { type: "reasoning", content: "step" },
        ],
      }), 422);
    });

    test("POST validation: setting version when url set → 422", async () => {
      await updateConfigWithUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      await expectToFail(av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hi" }],
        version: "1.0.0",
      }), 422);
    });

    test("POST validation: setting status when url set → 422", async () => {
      await updateConfigWithUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      await expectToFail(av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hi" }],
        status: "completed",
      }), 422);
    });

    test("POST validation: setting state when url set → 422", async () => {
      await updateConfigWithUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      await expectToFail(av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hi" }],
        state: { foo: "bar" },
      }), 422);
    });

    test("POST validation: setting failReason when url set → 422", async () => {
      await updateConfigWithUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      await expectToFail(av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hi" }],
        status: "failed",
        failReason: { message: "error" },
      }), 422);
    });

    test("PATCH blocked: PATCH with items while fetchStatus active → 422", async () => {
      await updateConfigWithUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      // Set up a slow handler so the run stays in fetching state
      mockAgentServer!.setHandler((_body, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });
        // Keep the stream open - don't end it
        // The cancellation below will cause the worker to abort
      });

      const run = await av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hi" }],
      });

      // Try to patch with items - should fail
      await expectToFail(av.updateRun({
        id: run.id,
        items: [{ type: "reasoning", content: "Thinking..." }],
      }), 422);

      // Cancel the run to clean up
      const cancelled = await av.updateRun({ id: run.id, status: "cancelled" });
      expect(cancelled.status).toBe("cancelled");
    }, 30000);

    test("PATCH cancellation: PATCH { status: 'cancelled' } → succeeds and aborts connection", async () => {
      await updateConfigWithUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      // Track whether the connection was closed, and when it's connected
      let connectionClosed = false;
      let connectionEstablished: () => void;
      const connectionEstablishedPromise = new Promise<void>(r => { connectionEstablished = r; });

      mockAgentServer!.setHandler((_body, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });
        connectionEstablished();
        // Send periodic keepalive events so the worker can detect cancellation
        const keepalive = setInterval(() => {
          if (!res.closed) {
            res.write(`event: keepalive\ndata: {}\n\n`);
          }
        }, 500);
        res.on('close', () => {
          clearInterval(keepalive);
          connectionClosed = true;
        });
      });

      const run = await av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hi" }],
      });

      // Wait for the worker to actually connect to the mock agent before cancelling
      await connectionEstablishedPromise;

      // Cancel the run
      const cancelled = await av.updateRun({ id: run.id, status: "cancelled" });
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.finishedAt).toBeDefined();

      // Wait for the worker to detect cancellation on the next event and abort
      await new Promise(r => setTimeout(r, 3000));
      expect(connectionClosed).toBe(true);
    }, 30000);

    test("error event: agent sends event: error → run marked failed", async () => {
      await updateConfigWithUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      mockAgentServer!.setHandler((_body, res) => {
        writeSSE(res, [
          { event: "error", data: { message: "Something went wrong" } },
        ]);
      });

      const run = await av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hi" }],
      });

      const failedRun = await waitForRunStatus(session.id, run.id, ["failed"]);
      expect(failedRun.status).toBe("failed");
      expect(failedRun.failReason).toBeDefined();
    }, 30000);

    test("bad HTTP response: agent returns 500 → run marked failed", async () => {
      await updateConfigWithUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      mockAgentServer!.setHandler((_body, res) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: "Internal Server Error" }));
      });

      const run = await av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hi" }],
      });

      const failedRun = await waitForRunStatus(session.id, run.id, ["failed"]);
      expect(failedRun.status).toBe("failed");
      expect(failedRun.failReason).toBeDefined();
    }, 30000);

    test("stream ends without completion → run fails", async () => {
      await updateConfigWithUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      mockAgentServer!.setHandler((_body, res) => {
        writeSSE(res, [
          { event: "run.patch", data: { items: [{ type: "reasoning", content: "Thinking..." }] } },
          // Stream ends without completing (no status: 'completed')
        ], { version: "1.0.0" });
      });

      const run = await av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hi" }],
      });

      const failedRun = await waitForRunStatus(session.id, run.id, ["failed"]);
      expect(failedRun.status).toBe("failed");
      expect(failedRun.failReason.message).toContain("Agent stream ended without completing");
    }, 30000);

    test("multiple incremental patches: items accumulate correctly", async () => {
      await updateConfigWithUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      mockAgentServer!.setHandler((_body, res) => {
        writeSSE(res, [
          { event: "run.patch", data: { items: [{ type: "reasoning", content: "Step 1" }] } },
          { event: "run.patch", data: { items: [{ type: "reasoning", content: "Step 2" }] } },
          { event: "run.patch", data: { items: [{ type: "reasoning", content: "Step 3" }] } },
          { event: "run.patch", data: { items: [{ type: "message", role: "assistant", content: "Final" }], status: "completed" } },
        ], { version: "1.0.0" });
      });

      const run = await av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hi" }],
      });

      const completedRun = await waitForRunStatus(session.id, run.id, ["completed"]);
      expect(completedRun.status).toBe("completed");
      // Should have 5 items: input + 3 steps + output
      expect(completedRun.sessionItems.length).toBe(5);
      expect(completedRun.sessionItems[1].content.content).toBe("Step 1");
      expect(completedRun.sessionItems[2].content.content).toBe("Step 2");
      expect(completedRun.sessionItems[3].content.content).toBe("Step 3");
      expect(completedRun.sessionItems[4].content.content).toBe("Final");
    }, 30000);

    test("agent must provide X-AgentView-Version header", async () => {
      await updateConfigWithUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      mockAgentServer!.setHandler((_body, res) => {
        // No version header → should fail when run.patch arrives
        writeSSE(res, [
          { event: "run.patch", data: { items: [{ type: "reasoning", content: "Thinking..." }] } },
        ]);
      });

      const run = await av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hi" }],
      });

      const failedRun = await waitForRunStatus(session.id, run.id, ["failed"]);
      expect(failedRun.status).toBe("failed");
      expect(failedRun.failReason.message).toContain("Version");
    }, 30000);
  });

  describe("agent endpoint auto-fetch (ai-sdk protocol)", () => {
    const AI_SDK_AGENT_PORT = 3458;
    const AI_SDK_AGENT_URL = `http://localhost:${AI_SDK_AGENT_PORT}/agent`;

    let mockAISDKServer: MockServer | null = null;

    const updateConfigWithAiSdkUrl = async () => {
      const inputSchema = z.looseObject({ type: z.literal("message"), role: z.literal("user"), content: z.string() });
      const outputSchema = z.looseObject({ type: z.literal("text"), text: z.string() });
      const stepSchema = z.looseObject({ type: z.literal("reasoning"), text: z.string() });

      await av.updateEnvironment({
        config: {
          agents: [{
            name: "test",
            url: AI_SDK_AGENT_URL,
            protocol: 'ai-sdk',
            runs: [{
              input: { schema: inputSchema },
              steps: [{ schema: stepSchema }],
              output: { schema: outputSchema },
            }]
          }],
          channels: [{ type: 'api', name: "test", agent: "test" }],
        },
      });
    };

    beforeAll(async () => {
      mockAISDKServer = await createMockServer(AI_SDK_AGENT_PORT);
    });

    afterAll(async () => {
      if (mockAISDKServer) {
        await mockAISDKServer.close();
        mockAISDKServer = null;
      }
    }, 30000);

    beforeEach(() => {
      mockAISDKServer?.resetRequests();
    });

    test("happy path: text response", async () => {
      await updateConfigWithAiSdkUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      mockAISDKServer!.setHandler((_body, res) => {
        writeAISDKStream(res, [
          { type: "start", messageId: "msg_1" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Hello " },
          { type: "text-delta", id: "t1", delta: "world!" },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: "stop" },
        ], { version: "1.0.0" });
      });

      const run = await av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hi" }],
      });

      expect(run.status).toBe("in_progress");

      const completedRun = await waitForRunStatus(session.id, run.id, ["completed"]);
      expect(completedRun.status).toBe("completed");
      expect(completedRun.version).toBe("1.0.0-dev");
      // Should have 2 items: input + text output
      expect(completedRun.sessionItems.length).toBe(2);
      expect(completedRun.sessionItems[0].content.type).toBe("message");
      expect(completedRun.sessionItems[0].content.role).toBe("user");
      expect(completedRun.sessionItems[1].content.type).toBe("text");
      expect(completedRun.sessionItems[1].content.text).toBe("Hello world!");
    }, 30000);

    test("happy path: text + reasoning", async () => {
      await updateConfigWithAiSdkUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      mockAISDKServer!.setHandler((_body, res) => {
        writeAISDKStream(res, [
          { type: "start", messageId: "msg_1" },
          { type: "reasoning-start", id: "r1" },
          { type: "reasoning-delta", id: "r1", delta: "Let me think..." },
          { type: "reasoning-end", id: "r1" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "The answer is 42" },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: "stop" },
        ], { version: "1.0.0" });
      });

      const run = await av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "What is the answer?" }],
      });

      const completedRun = await waitForRunStatus(session.id, run.id, ["completed"]);
      expect(completedRun.status).toBe("completed");
      // Should have 3 items: input + reasoning step + text output
      expect(completedRun.sessionItems.length).toBe(3);
      expect(completedRun.sessionItems[1].content.type).toBe("reasoning");
      expect(completedRun.sessionItems[1].content.text).toBe("Let me think...");
      expect(completedRun.sessionItems[2].content.type).toBe("text");
      expect(completedRun.sessionItems[2].content.text).toBe("The answer is 42");
    }, 30000);

    test("happy path: tool call", async () => {
      // Update config with tool-call step schema
      const inputSchema = z.looseObject({ type: z.literal("message"), role: z.literal("user"), content: z.string() });
      const outputSchema = z.looseObject({ type: z.literal("text"), text: z.string() });
      const reasoningSchema = z.looseObject({ type: z.literal("reasoning"), text: z.string() });
      const toolCallSchema = z.looseObject({ type: z.literal("tool-call"), toolCallId: z.string(), toolName: z.string(), state: z.string() });

      await av.updateEnvironment({
        config: {
          agents: [{
            name: "test",
            url: AI_SDK_AGENT_URL,
            protocol: 'ai-sdk',
            runs: [{
              input: { schema: inputSchema },
              steps: [{ schema: reasoningSchema }, { schema: toolCallSchema }],
              output: { schema: outputSchema },
            }]
          }],
          channels: [{ type: 'api', name: "test", agent: "test" }],
        },
      });

      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      mockAISDKServer!.setHandler((_body, res) => {
        writeAISDKStream(res, [
          { type: "start", messageId: "msg_1" },
          { type: "tool-input-start", toolCallId: "call_1", toolName: "getWeather" },
          { type: "tool-input-delta", toolCallId: "call_1", inputTextDelta: '{"city":"NYC"}' },
          { type: "tool-input-available", toolCallId: "call_1", toolName: "getWeather", input: { city: "NYC" } },
          { type: "tool-output-available", toolCallId: "call_1", output: { temp: 72 } },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "It's 72F in NYC" },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: "stop" },
        ], { version: "1.0.0" });
      });

      const run = await av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "What's the weather?" }],
      });

      const completedRun = await waitForRunStatus(session.id, run.id, ["completed"]);
      expect(completedRun.status).toBe("completed");
      // Should have 3 items: input + tool-call step + text output
      expect(completedRun.sessionItems.length).toBe(3);
      expect(completedRun.sessionItems[1].content.type).toBe("tool-call");
      expect(completedRun.sessionItems[1].content.toolName).toBe("getWeather");
      expect(completedRun.sessionItems[1].content.state).toBe("output-available");
      expect(completedRun.sessionItems[1].content.input).toEqual({ city: "NYC" });
      expect(completedRun.sessionItems[1].content.output).toEqual({ temp: 72 });
      expect(completedRun.sessionItems[2].content.type).toBe("text");
      expect(completedRun.sessionItems[2].content.text).toBe("It's 72F in NYC");
    }, 30000);

    test("version header: X-AgentView-Version → version set on run", async () => {
      await updateConfigWithAiSdkUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      mockAISDKServer!.setHandler((_body, res) => {
        writeAISDKStream(res, [
          { type: "start", messageId: "msg_1" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Hi" },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: "stop" },
        ], { version: "2.5.0" });
      });

      const run = await av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hi" }],
      });

      const completedRun = await waitForRunStatus(session.id, run.id, ["completed"]);
      expect(completedRun.version).toBe("2.5.0-dev");
    }, 30000);

    test("missing version header → run fails", async () => {
      await updateConfigWithAiSdkUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      mockAISDKServer!.setHandler((_body, res) => {
        // No version header
        writeAISDKStream(res, [
          { type: "start", messageId: "msg_1" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Hi" },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: "stop" },
        ]);
      });

      const run = await av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hi" }],
      });

      const failedRun = await waitForRunStatus(session.id, run.id, ["failed"]);
      expect(failedRun.status).toBe("failed");
      expect(failedRun.failReason.message).toContain("Version");
    }, 30000);

    test("error event → run marked failed", async () => {
      await updateConfigWithAiSdkUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      mockAISDKServer!.setHandler((_body, res) => {
        writeAISDKStream(res, [
          { type: "error", errorText: "Something went wrong" },
        ], { version: "1.0.0" });
      });

      const run = await av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hi" }],
      });

      const failedRun = await waitForRunStatus(session.id, run.id, ["failed"]);
      expect(failedRun.status).toBe("failed");
      expect(failedRun.failReason).toBeDefined();
    }, 30000);

    test("HTTP error: 500 → run marked failed", async () => {
      await updateConfigWithAiSdkUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      mockAISDKServer!.setHandler((_body, res) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: "Internal Server Error" }));
      });

      const run = await av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hi" }],
      });

      const failedRun = await waitForRunStatus(session.id, run.id, ["failed"]);
      expect(failedRun.status).toBe("failed");
      expect(failedRun.failReason).toBeDefined();
    }, 30000);

    test("stream ends without finish → run marked failed", async () => {
      await updateConfigWithAiSdkUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      mockAISDKServer!.setHandler((_body, res) => {
        writeAISDKStream(res, [
          { type: "start", messageId: "msg_1" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Partial..." },
          { type: "text-end", id: "t1" },
          // No finish event → stream ends without completing
        ], { version: "1.0.0" });
      });

      const run = await av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hi" }],
      });

      const failedRun = await waitForRunStatus(session.id, run.id, ["failed"]);
      expect(failedRun.status).toBe("failed");
      expect(failedRun.failReason.message).toContain("Agent stream ended without completing");
    }, 30000);

    test("request body format: sends UIMessage[] with correct history", async () => {
      await updateConfigWithAiSdkUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      mockAISDKServer!.setHandler((_body, res) => {
        writeAISDKStream(res, [
          { type: "start", messageId: "msg_1" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Hi there" },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: "stop" },
        ], { version: "1.0.0" });
      });

      const run = await av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hello AI SDK" }],
      });

      await waitForRunStatus(session.id, run.id, ["completed"]);

      // Verify request body format
      expect(mockAISDKServer!.requests.length).toBeGreaterThanOrEqual(1);
      const reqBody = mockAISDKServer!.requests[0].body;
      expect(reqBody.messages).toBeDefined();
      expect(Array.isArray(reqBody.messages)).toBe(true);
      expect(reqBody.messages.length).toBe(1);
      expect(reqBody.messages[0].role).toBe("user");
      expect(reqBody.messages[0].parts).toBeDefined();
      expect(reqBody.messages[0].parts[0].type).toBe("text");
      expect(reqBody.messages[0].parts[0].text).toBe("Hello AI SDK");
    }, 30000);

    test("multi-turn: second request has full conversation history", async () => {
      await updateConfigWithAiSdkUrl();
      const session = await av.createSession({ channel: "test", userId: initUser1.id});

      // First turn
      mockAISDKServer!.setHandler((_body, res) => {
        writeAISDKStream(res, [
          { type: "start", messageId: "msg_1" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "Hello!" },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: "stop" },
        ], { version: "1.0.0" });
      });

      const run1 = await av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "Hi" }],
      });

      await waitForRunStatus(session.id, run1.id, ["completed"]);

      // Second turn
      mockAISDKServer!.resetRequests();

      mockAISDKServer!.setHandler((_body, res) => {
        writeAISDKStream(res, [
          { type: "start", messageId: "msg_2" },
          { type: "text-start", id: "t2" },
          { type: "text-delta", id: "t2", delta: "I'm fine!" },
          { type: "text-end", id: "t2" },
          { type: "finish", finishReason: "stop" },
        ], { version: "1.0.0" });
      });

      const run2 = await av.createRun({
        sessionId: session.id,
        items: [{ type: "message", role: "user", content: "How are you?" }],
      });

      await waitForRunStatus(session.id, run2.id, ["completed"]);

      // Verify second request has full history
      expect(mockAISDKServer!.requests.length).toBeGreaterThanOrEqual(1);
      const reqBody = mockAISDKServer!.requests[0].body;
      expect(reqBody.messages).toBeDefined();
      // Should have 3 messages: user1, assistant1, user2
      expect(reqBody.messages.length).toBe(3);
      expect(reqBody.messages[0].role).toBe("user");
      expect(reqBody.messages[0].parts[0].text).toBe("Hi");
      expect(reqBody.messages[1].role).toBe("assistant");
      expect(reqBody.messages[1].parts[0].type).toBe("text");
      expect(reqBody.messages[1].parts[0].text).toBe("Hello!");
      expect(reqBody.messages[2].role).toBe("user");
      expect(reqBody.messages[2].parts[0].text).toBe("How are you?");
    }, 30000);
  });


});