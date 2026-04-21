import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { AgentViewError, type User } from 'agentview';

import { z } from 'zod';
import type { MockServer } from './mockServer';
import { createMockServer, writeAISDKChunks, writeAISDKDone, writeAISDKSuccessHeaders } from './mockServer';
// import { startProxyServer, type ProxyServer } from '@agentview/studio/proxy';
const { spawn } = require('child_process');


import { type UIDataTypes, type UIMessage, type UIMessageChunk } from 'ai';
import { setupTestOrg, expectToFail, UUID_REGEX } from './utils';

const PROXY_TIMEOUT = 10_000;
const TEST_TIMEOUT = PROXY_TIMEOUT + 10_000;

describe('ai-sdk', () => {
  let org: Awaited<ReturnType<typeof setupTestOrg>>;

  beforeAll(async () => {
    org = await setupTestOrg();
  })

  describe("agent endpoint auto-fetch (ai-sdk adapter)", () => {
    const AI_SDK_AGENT_PORT = 3458;
    const AI_SDK_AGENT_URL = `http://localhost:${AI_SDK_AGENT_PORT}/agent`;

    let mockAISDKServer: MockServer | null = null;

    function buildConfig(options?: { agentUrl?: string }) {
      const inputSchema = z.looseObject({ role: z.literal("user"), parts: z.array(z.any()) });
      const outputSchema = z.looseObject({ type: z.literal("text"), text: z.string() });
      const stepSchema = z.looseObject({ type: z.literal("reasoning"), text: z.string() });

      return {
        agents: [{
          name: "test-ai-sdk",
          version: "1.0.0",
          url: options?.agentUrl ?? AI_SDK_AGENT_URL,
          adapter: 'ai-sdk',
          runs: [{
            input: { schema: inputSchema },
            steps: [{ schema: stepSchema }],
            output: { schema: outputSchema },
          }]
        }],
        channels: [{ type: 'api', name: "test-ai-sdk", agent: "test-ai-sdk" }],
      };
    }

    function sendMessageViaTransport(transport: ReturnType<typeof org.prodClient.createTransport>, sessionId: string, input: UIMessage) {
      return transport.sendMessages({
        chatId: sessionId,
        messages: [input],
        trigger: "submit-message",
        messageId: undefined,
        abortSignal: undefined,
      })
    }
    async function consumeChunksFromTransportStream(stream: ReadableStream<UIMessageChunk<unknown, UIDataTypes>>) {
      let chunks : UIMessageChunk[] = []
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      return chunks;
    }


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


    // ---------------------------------------------------------------
    // All core tests run on BOTH environments:
    //   - "production (direct)": requests go straight to the agent
    //   - "local (via tunnel proxy)": requests go through the real
    //     proxy server from @agentview/studio (same code as `npx agentview dev`)
    // ---------------------------------------------------------------
    describe.each([
      { envName: "production (direct)", envType: "production" },
      // { envName: "local (via tunnel proxy)", envType: "local" },
    ])("$envName", ({ envType }) => {
      let client: typeof org.prodClient;
      let standardClient: typeof org.prodStandardClient;
      let proxyProcess: any;
      let user: User;

      beforeAll(async () => {
        if (envType === "local") {
          console.log("Using local environment (via proxy), starting proxy process...");
          client = org.admin.localClient;
          standardClient = org.admin.localStandardClient;

          // start real proxy with real tunnel
          proxyProcess = spawn('npx', ['agentview', 'dev', '--api-key', org.apiKeySecret.key, '--env', 'local:' + org.admin.user.email, '--no-studio'], {
            detached: true,
            stdio: 'inherit',
            shell: process.platform === 'win32' // needed on Windows for .cmd shims
          });
          proxyProcess.unref();

          await new Promise(resolve => setTimeout(resolve, PROXY_TIMEOUT));
        } else {
          console.log("Using production environment");
          client = org.prodClient;
          standardClient = org.prodStandardClient;
        }

        const result = await client.createUser();
        user = result.user;
        
      }, TEST_TIMEOUT);

      afterAll(async () => {
        if (proxyProcess?.pid) {
          try { process.kill(-proxyProcess.pid, 'SIGTERM'); } catch {}
        }
      });

      test("happy path: text response (validated via ai-sdk stream)", async () => {
        await standardClient.updateEnvironment({ config: buildConfig() });
        const session = await client.createSession({ agent: "test-ai-sdk", userId: user.id });

        mockAISDKServer!.setHandler((_body, res) => {
          writeAISDKSuccessHeaders(res);
          writeAISDKChunks(res, [
            { type: "start" },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Hello " },
            { type: "text-delta", id: "t1", delta: "world!" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: "stop" },
          ]);
          writeAISDKDone(res);
          res.end();
        });

        const stream = await sendMessageViaTransport(
          client.createTransport(),
          session.id,
          { id: "msg_1", role: "user", parts: [{ type: "text", text: "What is the answer?" }] }
        );

        const chunks = await consumeChunksFromTransportStream(stream);

        const chunkTypes = chunks.map(c => c.type);
        expect(chunkTypes).toContain("start");
        expect(chunkTypes).toContain("text-start");
        expect(chunkTypes).toContain("text-delta");
        expect(chunkTypes).toContain("text-end");
        expect(chunkTypes).toContain("finish");

        const textDeltas = chunks.filter(c => c.type === "text-delta");
        expect(textDeltas.map(d => d.delta).join("")).toBe("Hello world!");

        const finalSession = await client.getSession({ id: session.id });

        expect(finalSession.status).toBe("idle");
        expect(finalSession.messages.length).toBe(2);
        expect(finalSession.messages[0].role).toBe("user");
        expect(finalSession.messages[1].role).toBe("assistant");
        expect(finalSession.messages[1].parts.length).toBe(1);
        expect(finalSession.messages[1].parts[0].type).toBe("text");
        expect(finalSession.messages[1].parts[0].text).toBe("Hello world!");
      }, TEST_TIMEOUT);

      test("happy path: text + reasoning (validated via ai-sdk stream)", async () => {
        await standardClient.updateEnvironment({ config: buildConfig() });
        const session = await client.createSession({ agent: "test-ai-sdk", userId: user.id });

        mockAISDKServer!.setHandler((_body, res) => {
          writeAISDKSuccessHeaders(res);
          writeAISDKChunks(res, [
            { type: "start", messageId: "msg_1" },
            { type: "reasoning-start", id: "r1" },
            { type: "reasoning-delta", id: "r1", delta: "Let me think..." },
            { type: "reasoning-end", id: "r1" },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "The answer is 42" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: "stop" },
          ]);
          writeAISDKDone(res);
          res.end();
        });

        const stream = await sendMessageViaTransport(
          client.createTransport(),
          session.id,
          { id: "msg_1", role: "user", parts: [{ type: "text", text: "What is the answer?" }] }
        );

        const chunks = await consumeChunksFromTransportStream(stream);

        const chunkTypes = chunks.map(c => c.type);
        expect(chunkTypes).toContain("reasoning-start");
        expect(chunkTypes).toContain("reasoning-delta");
        expect(chunkTypes).toContain("reasoning-end");
        expect(chunkTypes).toContain("text-start");
        expect(chunkTypes).toContain("text-delta");
        expect(chunkTypes).toContain("text-end");
        expect(chunkTypes).toContain("finish");

        const reasoningDeltas = chunks.filter(c => c.type === "reasoning-delta");
        expect(reasoningDeltas.map(d => d.delta).join("")).toBe("Let me think...");

        const textDeltas = chunks.filter(c => c.type === "text-delta");
        expect(textDeltas.map(d => d.delta).join("")).toBe("The answer is 42");

        const finalSession = await standardClient.getSession({ id: session.id });
        const completedRun = finalSession.lastRun!;
        expect(completedRun.status).toBe("completed");
        expect(completedRun.sessionItems.length).toBe(3);
        expect(completedRun.sessionItems[1].content.type).toBe("reasoning");
        expect(completedRun.sessionItems[1].content.text).toBe("Let me think...");
        expect(completedRun.sessionItems[2].content.type).toBe("text");
        expect(completedRun.sessionItems[2].content.text).toBe("The answer is 42");
      }, TEST_TIMEOUT);

      test("happy path: tool call (validated via ai-sdk stream)", async () => {
        const inputSchema = z.looseObject({ role: z.literal("user"), parts: z.array(z.any()) });
        const outputSchema = z.looseObject({ type: z.literal("text"), text: z.string() });
        const reasoningSchema = z.looseObject({ type: z.literal("reasoning"), text: z.string() });
        const toolCallSchema = z.looseObject({ type: z.literal("tool-call"), toolCallId: z.string(), toolName: z.string(), state: z.string() });

        await standardClient.updateEnvironment({
          config: {
            agents: [{
              name: "test-ai-sdk",
              version: "1.0.0",
              url: AI_SDK_AGENT_URL,
              adapter: 'ai-sdk',
              runs: [{
                input: { schema: inputSchema },
                steps: [{ schema: reasoningSchema }, { schema: toolCallSchema }],
                output: { schema: outputSchema },
              }]
            }],
            channels: [{ type: 'api', name: "test-ai-sdk", agent: "test-ai-sdk" }],
          },
        });

        const session = await standardClient.createSession({ agent: "test-ai-sdk", userId: user.id });

        mockAISDKServer!.setHandler((_body, res) => {
          writeAISDKSuccessHeaders(res);
          writeAISDKChunks(res, [
            { type: "start", messageId: "msg_1" },
            { type: "tool-input-start", toolCallId: "call_1", toolName: "getWeather" },
            { type: "tool-input-delta", toolCallId: "call_1", inputTextDelta: '{"city":"NYC"}' },
            { type: "tool-input-available", toolCallId: "call_1", toolName: "getWeather", input: { city: "NYC" } },
            { type: "tool-output-available", toolCallId: "call_1", output: { temp: 72 } },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "It's 72F in NYC" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: "stop" },
          ]);
          writeAISDKDone(res);
          res.end();
        });

        const stream = await sendMessageViaTransport(
          client.createTransport(),
          session.id,
          { id: "msg_1", role: "user", parts: [{ type: "text", text: "What is the answer?" }] }
        );

        const chunks = await consumeChunksFromTransportStream(stream);

        const chunkTypes = chunks.map(c => c.type);
        expect(chunkTypes).toContain("tool-input-start");
        expect(chunkTypes).toContain("tool-input-delta");
        expect(chunkTypes).toContain("tool-input-available");
        expect(chunkTypes).toContain("tool-output-available");
        expect(chunkTypes).toContain("text-start");
        expect(chunkTypes).toContain("finish");

        const toolOutput = chunks.find(c => c.type === "tool-output-available");
        expect(toolOutput?.output).toEqual({ temp: 72 });

        const finalSession = await standardClient.getSession({ id: session.id });
        const completedRun = finalSession.lastRun!;
        expect(completedRun.status).toBe("completed");
        expect(completedRun.sessionItems.length).toBe(3);
        expect(completedRun.sessionItems[1].content.type).toBe("tool-getWeather");
        expect(completedRun.sessionItems[1].content.state).toBe("output-available");
        expect(completedRun.sessionItems[1].content.input).toEqual({ city: "NYC" });
        expect(completedRun.sessionItems[1].content.output).toEqual({ temp: 72 });
        expect(completedRun.sessionItems[2].content.type).toBe("text");
        expect(completedRun.sessionItems[2].content.text).toBe("It's 72F in NYC");
      }, TEST_TIMEOUT);


      test("error event → run marked failed (validated via ai-sdk stream)", async () => {
        await standardClient.updateEnvironment({ config: buildConfig() });
        const session = await standardClient.createSession({ agent: "test-ai-sdk", userId: user.id });

        mockAISDKServer!.setHandler((_body, res) => {
          writeAISDKSuccessHeaders(res);
          writeAISDKChunks(res, [
            { type: "error", errorText: "Something went wrong" },
          ]);
          writeAISDKDone(res);
          res.end();
        });

        const stream = await sendMessageViaTransport(
          client.createTransport(),
          session.id,
          { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] }
        );

        const chunks = await consumeChunksFromTransportStream(stream);

        expect(chunks.some(c => c.type === "error")).toBe(true);

        const updatedSession = await standardClient.getSession({ id: session.id });
        expect(updatedSession.lastRun!.status).toBe("failed");
        expect(updatedSession.lastRun!.failReason).toBeDefined();
      }, TEST_TIMEOUT);

      test("error → invalid chunk", async () => {
        await standardClient.updateEnvironment({ config: buildConfig() });
        const session = await standardClient.createSession({ agent: "test-ai-sdk", userId: user.id });

        mockAISDKServer!.setHandler((_body, res) => {
          writeAISDKSuccessHeaders(res);

          writeAISDKChunks(res, [
            { type: "start", messageId: "msg_1" },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Hello " },
            { type: "text-delta", id: "t1", delta: "world!" },
            { type: "text-end", id: "t1" },
            { type: "bad-chunk" },
            { type: "finish", finishReason: "stop" },
          ]);
          writeAISDKDone(res);
          res.end();
        });

        const stream = await sendMessageViaTransport(
          client.createTransport(),
          session.id,
          { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] }
        );

        const chunks = await consumeChunksFromTransportStream(stream);

        const updatedSession = await client.getSession({ id: session.id });

        expect(updatedSession.messages[1].parts.length).toBe(1);
        expect(updatedSession.messages[1].parts[0].type).toBe("text");
        expect(updatedSession.messages[1].parts[0].text).toBe("Hello world!");

        expect(updatedSession.status).toBe("failed");
        expect(updatedSession.failReason).toBeDefined();

      }, TEST_TIMEOUT);

      test("happy path: text response, creating run via session input -> reconnect to stream", async () => {
        await standardClient.updateEnvironment({ config: buildConfig() });

        mockAISDKServer!.setHandler((_body, res) => {
          writeAISDKSuccessHeaders(res);
          writeAISDKChunks(res, [
            { type: "start", messageId: "msg_1" },
          ]);

          setTimeout(() => {
            writeAISDKChunks(res, [
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "Hello " },
              { type: "text-delta", id: "t1", delta: "world!" },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: "stop" },
            ]);

            writeAISDKDone(res);
            res.end();
          }, 2000)
        });

        const session = await client.createSession({ agent: "test-ai-sdk", userId: user.id, input: { id: "msg_1", role: "user", parts: [{ type: "text", text: "What is the answer?" }] }});
        expect(session.status).toBe("in_progress");
        expect(session.messages.length).toBe(1);
        expect(session.messages[0]).toMatchObject({
          role: "user",
          parts: [{ type: "text", text: "What is the answer?" }]
        });

        const transport = client.createTransport()
        const stream = await transport.reconnectToStream({ chatId: session.id })
        if (!stream) {
          throw new Error("No stream to reconnect");
        }

        const chunks = await consumeChunksFromTransportStream(stream);

        const chunkTypes = chunks.map(c => c.type);
        expect(chunkTypes).toContain("start");
        expect(chunkTypes).toContain("text-start");
        expect(chunkTypes).toContain("text-delta");
        expect(chunkTypes).toContain("text-end");
        expect(chunkTypes).toContain("finish");

        const updatedSession = await client.getSession({ id: session.id });
        expect(updatedSession.status).toBe("idle");
        expect(updatedSession.messages.length).toBe(2);
        expect(updatedSession.messages[1].parts.length).toBe(1);
        expect(updatedSession.messages[1].parts[0]).toMatchObject({
          type: "text",
          text: "Hello world!"
        });

        const streamAfterCompletion = await transport.reconnectToStream({ chatId: session.id })
        expect(streamAfterCompletion).toBeNull();

      }, TEST_TIMEOUT);

      test("Upstream server is down → 502 error", async () => {
        await standardClient.updateEnvironment({ config: buildConfig({ agentUrl: "http://localhost:10000/this-server-is-down" }) }); // 
        const session = await client.createSession({ agent: "test-ai-sdk", userId: user.id });

        const stream = sendMessageViaTransport(
          client.createTransport(),
          session.id,
          { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] }
        );

        await expect(stream).rejects.toThrowError("CONNECTION_NETWORK_ERROR");

      }, TEST_TIMEOUT);


      test("HTTP error: 500 → run marked failed (validated via ai-sdk stream)", async () => {
        await standardClient.updateEnvironment({ config: buildConfig() });
        const session = await client.createSession({ agent: "test-ai-sdk", userId: user.id });

        mockAISDKServer!.setHandler((_body, res) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end("This is an error from test suite.");
        });

        const stream = sendMessageViaTransport(
          client.createTransport(),
          session.id,
          { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] }
        );

        await expect(stream).rejects.not.toBeInstanceOf(AgentViewError);
        await expect(stream).rejects.toThrowError("This is an error from test suite.");

        const updatedSession = await client.getSession({ id: session.id });
        expect(updatedSession.messages.length).toBe(0);
      }, TEST_TIMEOUT);

      test("HTTP error: 500 → client.createRun (no stream) passes error to client. No run is created.", async () => {
        await standardClient.updateEnvironment({ config: buildConfig() });
        const session = await client.createSession({ agent: "test-ai-sdk", userId: user.id });

        mockAISDKServer!.setHandler((_body, res) => {
          res.writeHead(500);
          res.end("This is an error from test suite.");
        });

        const promise = client.createRun({ sessionId: session.id, input: { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] } });

        await expect(promise).rejects.not.toBeInstanceOf(AgentViewError);
        await expect(promise).rejects.toThrowError("This is an error from test suite.");

        const updatedSession = await client.getSession({ id: session.id });
        expect(updatedSession.messages.length).toBe(0);
      }, TEST_TIMEOUT);

      test("HTTP error: 422 → client.createSession with input. No run is created", async () => {
        await standardClient.updateEnvironment({ config: buildConfig() });

        const jsonError = JSON.stringify({ message: "blah blah blah" });

        mockAISDKServer!.setHandler((_body, res) => {
          res.writeHead(422, { 'Content-Type': 'application/json' });
          res.end(jsonError);
        });

        const promise = client.createSession({ agent: "test-ai-sdk" , userId: user.id, input: { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] } });

        await expect(promise).rejects.not.toBeInstanceOf(AgentViewError);
        await expect(promise).rejects.toThrowError(jsonError);

      }, TEST_TIMEOUT);

      test("HTTP error 400: empty body in response → client.createSession with input. No run is created", async () => {
        await standardClient.updateEnvironment({ config: buildConfig() });

        mockAISDKServer!.setHandler((_body, res) => {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end("");
        });

        const promise = client.createSession({ agent: "test-ai-sdk" , userId: user.id, input: { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] } });

        await expect(promise).rejects.not.toBeInstanceOf(AgentViewError);
        await expect(promise).rejects.toThrowError("");

      }, TEST_TIMEOUT);

      test("stream aborted (no finish and no done) → run marked failed (validated via ai-sdk stream)", async () => {
        await standardClient.updateEnvironment({ config: buildConfig() });
        const session = await standardClient.createSession({ agent: "test-ai-sdk", userId: user.id });

        mockAISDKServer!.setHandler((_body, res) => {
          writeAISDKSuccessHeaders(res);
          writeAISDKChunks(res, [
            { type: "start", messageId: "msg_1" },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Partial..." },
            { type: "text-end", id: "t1" },
          ]);
          res.end();
        });

        const stream = await sendMessageViaTransport(
          client.createTransport(),
          session.id,
          { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] }
        );

        const chunks = await consumeChunksFromTransportStream(stream);

        expect(chunks.some(c => c.type === "text-delta")).toBe(true);
        expect(chunks.some(c => c.type === "finish")).toBe(false);

        const errorChunk = chunks.find(c => c.type === "error");
        expect(errorChunk).toBeDefined();
        expect(JSON.parse(errorChunk!.errorText)).toMatchObject({ source: "agentview", code: "STREAM_INCOMPLETE", message: "Stream ended incomplete" });

        const updatedSession = await standardClient.getSession({ id: session.id });
        expect(updatedSession.lastRun!.status).toBe("failed");
        expect(updatedSession.lastRun!.failReason.message).toContain("Stream ended incomplete");
      }, TEST_TIMEOUT);

      test("invalid chunk → run marked failed (validated via ai-sdk stream)", async () => {
        await standardClient.updateEnvironment({ config: buildConfig() });
        const session = await standardClient.createSession({ agent: "test-ai-sdk", userId: user.id });

        mockAISDKServer!.setHandler((_body, res) => {
          writeAISDKSuccessHeaders(res);
          writeAISDKChunks(res, [
            { type: "start", messageId: "msg_2" },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Hello." },
            { type: "text-end", id: "t1" },
            { type: "bad-chunk" },
            { type: "finish" },
          ]);
          res.end();
        });

        const stream = await sendMessageViaTransport(
          client.createTransport(),
          session.id,
          { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] }
        );

        const chunks = await consumeChunksFromTransportStream(stream);

        expect(chunks.some(c => c.type === "text-delta")).toBe(true);
        expect(chunks.some(c => c.type === "finish")).toBe(false);
        const errorChunk = chunks.find(c => c.type === "error");
        expect(errorChunk).toBeDefined();
        expect(JSON.parse(errorChunk!.errorText)).toMatchObject({ source: "agentview", code: "STREAM_INVALID_CHUNK", message: expect.any(String), data: "{\"type\":\"bad-chunk\"}" });

        const updatedSession = await standardClient.getSession({ id: session.id });
        expect(updatedSession.lastRun!.status).toBe("failed");
        expect(updatedSession.lastRun!.failReason.message).toContain("Unknown chunk type");
      }, TEST_TIMEOUT);


      test("request body format: sends UIMessage[] with correct history", async () => {
        await standardClient.updateEnvironment({ config: buildConfig() });
        const session = await standardClient.createSession({ agent: "test-ai-sdk", userId: user.id });

        mockAISDKServer!.setHandler((_body, res) => {
          writeAISDKSuccessHeaders(res);
          writeAISDKChunks(res, [
            { type: "start", messageId: "msg_1" },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Hi there" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: "stop" },
          ]);
          writeAISDKDone(res);
          res.end();
        });

        const stream = await sendMessageViaTransport(
          client.createTransport(),
          session.id,
          { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hello AI SDK" }] }
        );

        await consumeChunksFromTransportStream(stream);

        expect(mockAISDKServer!.requests.length).toBeGreaterThanOrEqual(1);
        const reqBody = mockAISDKServer!.requests[0].body;
        expect(reqBody.messages).toBeDefined();
        expect(Array.isArray(reqBody.messages)).toBe(true);
        expect(reqBody.messages.length).toBe(1);
        expect(reqBody.messages[0].role).toBe("user");
        expect(reqBody.messages[0].parts).toBeDefined();
        expect(reqBody.messages[0].parts[0].type).toBe("text");
        expect(reqBody.messages[0].parts[0].text).toBe("Hello AI SDK");
      }, TEST_TIMEOUT);

      test("multi-turn: second request has full conversation history", async () => {
        await standardClient.updateEnvironment({ config: buildConfig() });
        const session = await standardClient.createSession({ agent: "test-ai-sdk", userId: user.id  });

        // First turn
        mockAISDKServer!.setHandler((_body, res) => {
          writeAISDKSuccessHeaders(res);
          writeAISDKChunks(res, [
            { type: "start", messageId: "msg_1" },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Hello!" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: "stop" },
          ]);
          writeAISDKDone(res);
          res.end();
        });

        const stream = await sendMessageViaTransport(
          client.createTransport(),
          session.id,
          { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] }
        );

        await consumeChunksFromTransportStream(stream);

        // Second turn
        mockAISDKServer!.resetRequests();

        mockAISDKServer!.setHandler((_body, res) => {
          writeAISDKSuccessHeaders(res);
          writeAISDKChunks(res, [
            { type: "start", messageId: "msg_2" },
            { type: "text-start", id: "t2" },
            { type: "text-delta", id: "t2", delta: "I'm fine!" },
            { type: "text-end", id: "t2" },
            { type: "finish", finishReason: "stop" },
          ]);
          writeAISDKDone(res);
        });

        const stream2 = await sendMessageViaTransport(
          client.createTransport(),
          session.id,
          { id: "msg_1", role: "user", parts: [{ type: "text", text: "How are you?" }] }
        );

        await consumeChunksFromTransportStream(stream2);

        expect(mockAISDKServer!.requests.length).toBeGreaterThanOrEqual(1);
        const reqBody = mockAISDKServer!.requests[0].body;
        expect(reqBody.messages).toBeDefined();
        expect(reqBody.messages.length).toBe(3);
        expect(reqBody.messages[0].role).toBe("user");
        expect(reqBody.messages[0].parts[0].text).toBe("Hi");
        expect(reqBody.messages[1].role).toBe("assistant");
        expect(reqBody.messages[1].parts[0].type).toBe("text");
        expect(reqBody.messages[1].parts[0].text).toBe("Hello!");
        expect(reqBody.messages[2].role).toBe("user");
        expect(reqBody.messages[2].parts[0].text).toBe("How are you?");
      }, TEST_TIMEOUT);

      test("cancellation → run cancelled and agent connection aborted", async () => {
        await standardClient.updateEnvironment({ config: buildConfig() });
        const session = await standardClient.createSession({ agent: "test-ai-sdk", userId: user.id });

        let connectionClosed = false;
        let connectionEstablished: () => void;
        const connectionEstablishedPromise = new Promise<void>(r => { connectionEstablished = r; });

        mockAISDKServer!.setHandler((_body, res) => {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
          });

          res.write(`data: ${JSON.stringify({ type: "start", messageId: "msg_1" })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: "text-start", id: "t1" })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: "text-delta", id: "t1", delta: "First chunk" })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: "text-end", id: "t1" })}\n\n`);

          connectionEstablished();

          res.write(`data: ${JSON.stringify({ type: "text-start", id: "t2" })}\n\n`);

          const interval = setInterval(() => {
            if (!res.closed) {
              res.write(`data: ${JSON.stringify({ type: "text-delta", id: "t2", delta: "." })}\n\n`);
            }
          }, 10);

          res.on('close', () => {
            clearInterval(interval);
            connectionClosed = true;
          });
        });

        const streamPromise = sendMessageViaTransport(
          client.createTransport(),
          session.id,
          { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hello" }] }
        )

        await connectionEstablishedPromise;
        await new Promise(r => setTimeout(r, 1000));

        const cancelled = await standardClient.cancelRun({ sessionId: session.id });
        expect(cancelled.lastRun?.status).toBe("cancelled");
        expect(cancelled.lastRun?.finishedAt).toBeDefined();

        const updatedSession = await standardClient.getSession({ id: session.id });
        expect(updatedSession.lastRun?.status).toBe("cancelled");
        expect(updatedSession.lastRun?.finishedAt).toBeDefined();
        expect(updatedSession.lastRun?.sessionItems.length).toBe(3);
        expect(updatedSession.lastRun?.sessionItems[1].content.type).toBe("text");
        expect(updatedSession.lastRun?.sessionItems[1].content.text).toBe("First chunk");

        expect(updatedSession.lastRun?.sessionItems[2].content.type).toBe("text");
        expect(updatedSession.lastRun?.sessionItems[2].content.text).toMatch(/^\.+$/);

        await new Promise(r => setTimeout(r, 500));
        expect(connectionClosed).toBe(true);

        await streamPromise;
      }, TEST_TIMEOUT);


      test("message id is auto set when undefined", async () => {
        await standardClient.updateEnvironment({ config: buildConfig() });
        const session = await client.createSession({ agent: "test-ai-sdk", userId: user.id });

        mockAISDKServer!.setHandler((_body, res) => {
          writeAISDKSuccessHeaders(res);
          writeAISDKChunks(res, [
            { type: "start" },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Hello " },
            { type: "text-delta", id: "t1", delta: "world!" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: "stop" },
          ]);
          writeAISDKDone(res);
          res.end();
        });

        const stream = await sendMessageViaTransport(
          client.createTransport(),
          session.id,
          { id: "msg_1", role: "user", parts: [{ type: "text", text: "What is the answer?" }] }
        );

        await consumeChunksFromTransportStream(stream);

        const finalSession = await client.getSession({ id: session.id });
        expect(finalSession.messages[1].id).toMatch(UUID_REGEX);
      }, TEST_TIMEOUT);

      test("input message id is auto set when not provided", async () => {
        await standardClient.updateEnvironment({ config: buildConfig() });

        mockAISDKServer!.setHandler((_body, res) => {
          writeAISDKSuccessHeaders(res);
          writeAISDKChunks(res, [
            { type: "start" },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Hi" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: "stop" },
          ]);
          writeAISDKDone(res);
          res.end();
        });

        // for session
        const session = await client.createSession({
          agent: "test-ai-sdk",
          userId: user.id,
          input: { role: "user", parts: [{ type: "text", text: "Hello" }] },
        });

        expect(session.messages[0].id).toMatch(UUID_REGEX);

        // for run
        const session2 = await client.createSession({ agent: "test-ai-sdk", userId: user.id });
        await client.createRun({ sessionId: session2.id, input: { role: "user", parts: [{ type: "text", text: "Hello" }] }});
        const finalSession2 = await client.getSession({ id: session2.id });
        expect(finalSession2.messages[0].id).toMatch(UUID_REGEX);
      }, TEST_TIMEOUT);


      test("message id + metadata are preserved when provided", async () => {
        await standardClient.updateEnvironment({ config: buildConfig() });
        const session = await client.createSession({ agent: "test-ai-sdk", userId: user.id });

        mockAISDKServer!.setHandler((_body, res) => {
          writeAISDKSuccessHeaders(res);
          writeAISDKChunks(res, [
            { type: "start", messageId: "msg_assistant_1", messageMetadata: { a: "aaa" } },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Hello " },
            { type: "message-metadata", messageMetadata: { b: { bb: "xxx" } } },
            { type: "text-delta", id: "t1", delta: "world!" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: "stop", messageMetadata: { c: 100 }  },
          ]);
          writeAISDKDone(res);
          res.end();
        });

        const stream = await sendMessageViaTransport(
          client.createTransport(),
          session.id,
          { id: "msg_1", role: "user", parts: [{ type: "text", text: "What is the answer?" }] }
        );

        await consumeChunksFromTransportStream(stream);

        const finalSession = await client.getSession({ id: session.id });
        expect(finalSession.messages[1].id).toBe("msg_assistant_1");
        expect(finalSession.messages[1].metadata).toMatchObject({
          a: "aaa",
          b: { bb: "xxx" },
          c: 100,
        });
      }, TEST_TIMEOUT);

      test("tools inputs are objects, partial tool call is object too", async () => {
        await standardClient.updateEnvironment({ config: buildConfig() });
        const session = await client.createSession({ agent: "test-ai-sdk", userId: user.id });

        mockAISDKServer!.setHandler((_body, res) => {
          writeAISDKSuccessHeaders(res);
          writeAISDKChunks(res, [
            { type: "start" },

            // normal full tool
            { type: "tool-input-available", toolCallId: "111", toolName: "getInfo", input: { importantInfo: "some info", number: 10 } },

            { type: "tool-input-start", toolCallId: "222", toolName: "getWeather" },
            { type: "tool-input-delta", toolCallId: "222", inputTextDelta: '{ "city": "War' },
            { type: "tool-input-delta", toolCallId: "222", inputTextDelta: 'szawa", "unit": "ce' },
            { type: "tool-input-delta", toolCallId: "222", inputTextDelta: 'lsius", "days": ' },
            { type: "tool-input-delta", toolCallId: "222", inputTextDelta: '2' },
            { type: "error", errorText: "whatever" }
          ]);
          writeAISDKDone(res);
          res.end();
        });

        const stream = await sendMessageViaTransport(
          client.createTransport(),
          session.id,
          { id: "msg_1", role: "user", parts: [{ type: "text", text: "What is the answer?" }] }
        );

        await consumeChunksFromTransportStream(stream);

        const finalSession = await client.getSession({ id: session.id });
        expect(finalSession.messages[1].parts[0]).toMatchObject({
          type: "tool-getInfo",
          toolCallId: "111",
          state: "input-available",
          input: { importantInfo: "some info", number: 10 },
        });

        expect(finalSession.messages[1].parts[1]).toMatchObject({
          type: "tool-getWeather",
          toolCallId: "222",
          state: "input-streaming",
          input: { city: "Warszawa", unit: "celsius" },
        });

      }, TEST_TIMEOUT);
    });


  });


});
