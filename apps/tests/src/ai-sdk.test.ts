import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { AgentViewError } from 'agentview';

import { z } from 'zod';
import type { MockServer } from './mockServer';
import { createMockServer, writeAISDKChunks, writeAISDKDone, writeAISDKSuccessHeaders } from './mockServer';

import { type UIDataTypes, type UIMessage, type UIMessageChunk } from 'ai';
import { setupTestOrg, expectToFail, UUID_REGEX } from './utils';

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

    test("happy path: text response (validated via ai-sdk stream)", async () => {
      await org.prodStandardClient.updateEnvironment({ config: buildConfig() });
      const session = await org.prodClient.createSession({ agent: "test-ai-sdk" });

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

      // Create run and get the native AI SDK stream
      const stream = await sendMessageViaTransport(
        org.prodClient.createTransport(), 
        session.id, 
        { id: "msg_1", role: "user", parts: [{ type: "text", text: "What is the answer?" }] }
      );

      const chunks = await consumeChunksFromTransportStream(stream);

      // Validate we received the native AI SDK chunk types
      const chunkTypes = chunks.map(c => c.type);
      expect(chunkTypes).toContain("start");
      expect(chunkTypes).toContain("text-start");
      expect(chunkTypes).toContain("text-delta");
      expect(chunkTypes).toContain("text-end");
      expect(chunkTypes).toContain("finish");

      // Validate text deltas
      const textDeltas = chunks.filter(c => c.type === "text-delta");
      expect(textDeltas.map(d => d.delta).join("")).toBe("Hello world!");

      // Verify final run state via API
      const finalSession = await org.prodClient.getSession({ id: session.id });

      expect(finalSession.status).toBe("idle");
      expect(finalSession.messages.length).toBe(2);
      expect(finalSession.messages[0].role).toBe("user");
      expect(finalSession.messages[1].role).toBe("assistant");
      expect(finalSession.messages[1].parts.length).toBe(1);
      expect(finalSession.messages[1].parts[0].type).toBe("text");
      expect(finalSession.messages[1].parts[0].text).toBe("Hello world!");
    }, 10000);

    test("happy path: text + reasoning (validated via ai-sdk stream)", async () => {
      await org.prodStandardClient.updateEnvironment({ config: buildConfig() });
      const session = await org.prodClient.createSession({ agent: "test-ai-sdk" });

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
        org.prodClient.createTransport(), 
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

      // Validate reasoning deltas
      const reasoningDeltas = chunks.filter(c => c.type === "reasoning-delta");
      expect(reasoningDeltas.map(d => d.delta).join("")).toBe("Let me think...");

      // Validate text deltas
      const textDeltas = chunks.filter(c => c.type === "text-delta");
      expect(textDeltas.map(d => d.delta).join("")).toBe("The answer is 42");

      // Verify final run state
      const finalSession = await org.prodStandardClient.getSession({ id: session.id });
      const completedRun = finalSession.lastRun!;
      expect(completedRun.status).toBe("completed");
      expect(completedRun.sessionItems.length).toBe(3);
      expect(completedRun.sessionItems[1].content.type).toBe("reasoning");
      expect(completedRun.sessionItems[1].content.text).toBe("Let me think...");
      expect(completedRun.sessionItems[2].content.type).toBe("text");
      expect(completedRun.sessionItems[2].content.text).toBe("The answer is 42");
    }, 10000);

    test("happy path: tool call (validated via ai-sdk stream)", async () => {
      // Update config with tool-call step schema
      const inputSchema = z.looseObject({ role: z.literal("user"), parts: z.array(z.any()) });
      const outputSchema = z.looseObject({ type: z.literal("text"), text: z.string() });
      const reasoningSchema = z.looseObject({ type: z.literal("reasoning"), text: z.string() });
      const toolCallSchema = z.looseObject({ type: z.literal("tool-call"), toolCallId: z.string(), toolName: z.string(), state: z.string() });

      await org.prodStandardClient.updateEnvironment({
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

      const session = await org.prodStandardClient.createSession({ agent: "test-ai-sdk" });

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

      // Create run and get the native AI SDK stream

      const stream = await sendMessageViaTransport(
        org.prodClient.createTransport(), 
        session.id, 
        { id: "msg_1", role: "user", parts: [{ type: "text", text: "What is the answer?" }] }
      );

      const chunks = await consumeChunksFromTransportStream(stream);

      // Validate stream includes tool call events
      const chunkTypes = chunks.map(c => c.type);
      expect(chunkTypes).toContain("tool-input-start");
      expect(chunkTypes).toContain("tool-input-delta");
      expect(chunkTypes).toContain("tool-input-available");
      expect(chunkTypes).toContain("tool-output-available");
      expect(chunkTypes).toContain("text-start");
      expect(chunkTypes).toContain("finish");

      // Validate tool output chunk
      const toolOutput = chunks.find(c => c.type === "tool-output-available");
      expect(toolOutput?.output).toEqual({ temp: 72 });

      // Verify final run state
      const finalSession = await org.prodStandardClient.getSession({ id: session.id });
      const completedRun = finalSession.lastRun!;
      expect(completedRun.status).toBe("completed");
      expect(completedRun.sessionItems.length).toBe(3);
      expect(completedRun.sessionItems[1].content.type).toBe("tool-getWeather");
      expect(completedRun.sessionItems[1].content.state).toBe("output-available");
      expect(completedRun.sessionItems[1].content.input).toEqual({ city: "NYC" });
      expect(completedRun.sessionItems[1].content.output).toEqual({ temp: 72 });
      expect(completedRun.sessionItems[2].content.type).toBe("text");
      expect(completedRun.sessionItems[2].content.text).toBe("It's 72F in NYC");
    }, 10000);


    test("error event → run marked failed (validated via ai-sdk stream)", async () => {
      await org.prodStandardClient.updateEnvironment({ config: buildConfig() });
      const session = await org.prodStandardClient.createSession({ agent: "test-ai-sdk" });

      mockAISDKServer!.setHandler((_body, res) => {
        writeAISDKSuccessHeaders(res);
        writeAISDKChunks(res, [
          { type: "error", errorText: "Something went wrong" },
        ]);
        writeAISDKDone(res);
        res.end();
      });

      // Create run and consume the AI SDK stream
      const stream = await sendMessageViaTransport(
        org.prodClient.createTransport(), 
        session.id, 
        { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] }
      );

      const chunks = await consumeChunksFromTransportStream(stream);

      // The error chunk should be in the stream
      expect(chunks.some(c => c.type === "error")).toBe(true);

      // Changes should be available immediately after stream ends
      const updatedSession = await org.prodStandardClient.getSession({ id: session.id });
      expect(updatedSession.lastRun!.status).toBe("failed");
      expect(updatedSession.lastRun!.failReason).toBeDefined();
    }, 10000);

    test("error → invalid chunk", async () => {
      await org.prodStandardClient.updateEnvironment({ config: buildConfig() });
      const session = await org.prodStandardClient.createSession({ agent: "test-ai-sdk" });

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

      // Create run and consume the AI SDK stream
      const stream = await sendMessageViaTransport(
        org.prodClient.createTransport(), 
        session.id, 
        { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] }
      );

      const chunks = await consumeChunksFromTransportStream(stream);

      // Changes should be available immediately after stream ends
      const updatedSession = await org.prodClient.getSession({ id: session.id });

      expect(updatedSession.messages[1].parts.length).toBe(1);
      expect(updatedSession.messages[1].parts[0].type).toBe("text");
      expect(updatedSession.messages[1].parts[0].text).toBe("Hello world!");

      expect(updatedSession.status).toBe("failed");
      expect(updatedSession.failReason).toBeDefined();

    }, 10000);

    /**
     * TODO: This test is not yet working as expected.
     * - createSession 
     * - reconnect to the stream
     * - consume the stream
     */
    test("happy path: text response, creating run via session input -> reconnect to stream", async () => {
      await org.prodStandardClient.updateEnvironment({ config: buildConfig() });

      mockAISDKServer!.setHandler((_body, res) => {
        writeAISDKSuccessHeaders(res);
        writeAISDKChunks(res, [
          { type: "start", messageId: "msg_1" },
        ]);

        // 2s wait so that we're sure when we reconnect the stream still exists
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

      const session = await org.prodClient.createSession({ agent: "test-ai-sdk" , input: { id: "msg_1", role: "user", parts: [{ type: "text", text: "What is the answer?" }] }});
      expect(session.status).toBe("in_progress");
      expect(session.messages.length).toBe(1);
      expect(session.messages[0]).toMatchObject({
        role: "user",
        parts: [{ type: "text", text: "What is the answer?" }]
      });

      // reconnect to stream
      const transport = org.prodClient.createTransport()
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

      const updatedSession = await org.prodClient.getSession({ id: session.id });
      expect(updatedSession.status).toBe("idle");
      expect(updatedSession.messages.length).toBe(2);
      expect(updatedSession.messages[1].parts.length).toBe(1);
      expect(updatedSession.messages[1].parts[0]).toMatchObject({
        type: "text",
        text: "Hello world!"
      });

      const streamAfterCompletion = await transport.reconnectToStream({ chatId: session.id })
      expect(streamAfterCompletion).toBeNull();

    }, 10000);


    test("HTTP error: 500 → run marked failed (validated via ai-sdk stream)", async () => {
      await org.prodStandardClient.updateEnvironment({ config: buildConfig() });
      const session = await org.prodClient.createSession({ agent: "test-ai-sdk" });

      mockAISDKServer!.setHandler((_body, res) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end("This is an error from test suite.");
      });

      const stream = sendMessageViaTransport(
        org.prodClient.createTransport(), 
        session.id, 
        { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] }
      );

      await expect(stream).rejects.not.toBeInstanceOf(AgentViewError);
      await expect(stream).rejects.toThrowError("This is an error from test suite.");

      // The stream ends before the worker marks the run as failed, so wait briefly
      const updatedSession = await org.prodClient.getSession({ id: session.id });
      expect(updatedSession.messages.length).toBe(0); // Error from AI endpoint means no messages are saved (user message included)
    }, 10000);

    test("HTTP error: 500 → client.createRun (no stream) passes error to client. No run is created.", async () => {
      await org.prodStandardClient.updateEnvironment({ config: buildConfig() });
      const session = await org.prodClient.createSession({ agent: "test-ai-sdk" });

      mockAISDKServer!.setHandler((_body, res) => {
        res.writeHead(500);
        res.end("This is an error from test suite.");
      });

      const promise = org.prodClient.createRun({ sessionId: session.id, input: { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] } });

      await expect(promise).rejects.not.toBeInstanceOf(AgentViewError);
      await expect(promise).rejects.toThrowError("This is an error from test suite.");

      // The stream ends before the worker marks the run as failed, so wait briefly
      const updatedSession = await org.prodClient.getSession({ id: session.id });
      expect(updatedSession.messages.length).toBe(0); // Error from AI endpoint means no messages are saved (user message included)
    }, 10000);

    test("HTTP error: 422 → client.createSession with input. No run is created", async () => {
      await org.prodStandardClient.updateEnvironment({ config: buildConfig() });

      const jsonError = JSON.stringify({ message: "blah blah blah" });

      mockAISDKServer!.setHandler((_body, res) => {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(jsonError);
      });

      const promise = org.prodClient.createSession({ agent: "test-ai-sdk" , input: { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] } });

      await expect(promise).rejects.not.toBeInstanceOf(AgentViewError);
      await expect(promise).rejects.toThrowError(jsonError);

    }, 10000);

    test("HTTP error 400: empty body in response → client.createSession with input. No run is created", async () => {
      await org.prodStandardClient.updateEnvironment({ config: buildConfig() });

      mockAISDKServer!.setHandler((_body, res) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end("");
      });

      const promise = org.prodClient.createSession({ agent: "test-ai-sdk" , input: { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] } });

      await expect(promise).rejects.not.toBeInstanceOf(AgentViewError);
      await expect(promise).rejects.toThrowError("");

    }, 10000);

    test("Error HTTP endpoint is down → client.createRun (no stream) passes error to client. No run is created.", async () => {
      await org.prodStandardClient.updateEnvironment({ config: buildConfig({ agentUrl: "http://localhost:10000/this-url-is-down" }) });

      const promise = org.prodClient.createSession({ agent: "test-ai-sdk" , input: { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] } });

      await expect(promise).rejects.toBeInstanceOf(AgentViewError);
      await expect(promise).rejects.toThrowError(expect.objectContaining({
        statusCode: 502
      }));
    }, 10000);


    test("stream aborted (no finish and no done) → run marked failed (validated via ai-sdk stream)", async () => {
      await org.prodStandardClient.updateEnvironment({ config: buildConfig() });
      const session = await org.prodStandardClient.createSession({ agent: "test-ai-sdk" });

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
        org.prodClient.createTransport(), 
        session.id, 
        { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] }
      );

      const chunks = await consumeChunksFromTransportStream(stream);

      // We should see the partial chunks but no finish
      expect(chunks.some(c => c.type === "text-delta")).toBe(true);
      expect(chunks.some(c => c.type === "finish")).toBe(false);

      const errorChunk = chunks.find(c => c.type === "error");
      expect(errorChunk).toBeDefined();
      expect(JSON.parse(errorChunk!.errorText)).toMatchObject({ source: "agentview", code: "STREAM_INCOMPLETE", message: "Stream ended incomplete" });

      const updatedSession = await org.prodStandardClient.getSession({ id: session.id });
      expect(updatedSession.lastRun!.status).toBe("failed");
      expect(updatedSession.lastRun!.failReason.message).toContain("Stream ended incomplete");
    }, 10000);

    test("invalid chunk → run marked failed (validated via ai-sdk stream)", async () => {
      await org.prodStandardClient.updateEnvironment({ config: buildConfig() });
      const session = await org.prodStandardClient.createSession({ agent: "test-ai-sdk" });

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
        org.prodClient.createTransport(), 
        session.id, 
        { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hi" }] }
      );

      const chunks = await consumeChunksFromTransportStream(stream);

      // We should see the partial chunks but no finish
      expect(chunks.some(c => c.type === "text-delta")).toBe(true);
      expect(chunks.some(c => c.type === "finish")).toBe(false);
      const errorChunk = chunks.find(c => c.type === "error");
      expect(errorChunk).toBeDefined();
      expect(JSON.parse(errorChunk!.errorText)).toMatchObject({ source: "agentview", code: "STREAM_INVALID_CHUNK", message: expect.any(String), data: "{\"type\":\"bad-chunk\"}" });

      const updatedSession = await org.prodStandardClient.getSession({ id: session.id });
      expect(updatedSession.lastRun!.status).toBe("failed");
      expect(updatedSession.lastRun!.failReason.message).toContain("Unknown chunk type");
    }, 10000);


    test("request body format: sends UIMessage[] with correct history", async () => {
      await org.prodStandardClient.updateEnvironment({ config: buildConfig() });
      const session = await org.prodStandardClient.createSession({ agent: "test-ai-sdk" });

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

      // Use createRunStream so we wait for the stream to complete
      const stream = await sendMessageViaTransport(
        org.prodClient.createTransport(), 
        session.id, 
        { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hello AI SDK" }] }
      );

      await consumeChunksFromTransportStream(stream);

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
    }, 10000);

    test("multi-turn: second request has full conversation history", async () => {
      await org.prodStandardClient.updateEnvironment({ config: buildConfig() });
      const session = await org.prodStandardClient.createSession({ agent: "test-ai-sdk" });

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
        org.prodClient.createTransport(), 
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
        org.prodClient.createTransport(), 
        session.id, 
        { id: "msg_1", role: "user", parts: [{ type: "text", text: "How are you?" }] }
      );

      await consumeChunksFromTransportStream(stream2);

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
    }, 10000);

    test("cancellation → run cancelled and agent connection aborted", async () => {
      await org.prodStandardClient.updateEnvironment({ config: buildConfig() });
      const session = await org.prodStandardClient.createSession({ agent: "test-ai-sdk" });

      // Track connection state
      let connectionClosed = false;
      let connectionEstablished: () => void;
      const connectionEstablishedPromise = new Promise<void>(r => { connectionEstablished = r; });

      mockAISDKServer!.setHandler((_body, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });

        // Send start event so the stream is established
        res.write(`data: ${JSON.stringify({ type: "start", messageId: "msg_1" })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "text-start", id: "t1" })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "text-delta", id: "t1", delta: "First chunk" })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "text-end", id: "t1" })}\n\n`);

        connectionEstablished();

        res.write(`data: ${JSON.stringify({ type: "text-start", id: "t2" })}\n\n`);

        // Send periodic deltas to keep the stream alive
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

      // Start consuming the stream in background (don't await - it'll hang until stream ends)
      const streamPromise = sendMessageViaTransport(
        org.prodClient.createTransport(),
        session.id,
        { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hello" }] }
      )

      // Wait for the agent connection to be established
      await connectionEstablishedPromise;
      await new Promise(r => setTimeout(r, 1000)); // IMPORTANT. Makes sure cancellation happens after the text is saved.

      // Cancel the run
      // TODO: - make those AI SDK calls, not av!!! (we must have 'cancel' status available)
      const cancelled = await org.prodStandardClient.cancelRun({ sessionId: session.id });
      expect(cancelled.lastRun?.status).toBe("cancelled");
      expect(cancelled.lastRun?.finishedAt).toBeDefined();

      const updatedSession = await org.prodStandardClient.getSession({ id: session.id });
      expect(updatedSession.lastRun?.status).toBe("cancelled");
      expect(updatedSession.lastRun?.finishedAt).toBeDefined();
      expect(updatedSession.lastRun?.sessionItems.length).toBe(3);
      expect(updatedSession.lastRun?.sessionItems[1].content.type).toBe("text");
      expect(updatedSession.lastRun?.sessionItems[1].content.text).toBe("First chunk");

      expect(updatedSession.lastRun?.sessionItems[2].content.type).toBe("text");
      expect(updatedSession.lastRun?.sessionItems[2].content.text).toMatch(/^\.+$/); // just "...."

      // Wait for the worker to detect cancellation and abort the connection
      await new Promise(r => setTimeout(r, 500));
      expect(connectionClosed).toBe(true);

      // Ensure stream promise settles
      await streamPromise;
    }, 10000);


    test("message id is auto set when undefined", async () => {
      await org.prodStandardClient.updateEnvironment({ config: buildConfig() });
      const session = await org.prodClient.createSession({ agent: "test-ai-sdk" });

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

      // Create run and get the native AI SDK stream
      const stream = await sendMessageViaTransport(
        org.prodClient.createTransport(), 
        session.id, 
        { id: "msg_1", role: "user", parts: [{ type: "text", text: "What is the answer?" }] }
      );

      await consumeChunksFromTransportStream(stream);

      // Verify final run state via API
      const finalSession = await org.prodClient.getSession({ id: session.id });
      expect(finalSession.messages[1].id).toMatch(UUID_REGEX);
    }, 10000);

    test("message id + metadata are preserved when provided", async () => {
      await org.prodStandardClient.updateEnvironment({ config: buildConfig() });
      const session = await org.prodClient.createSession({ agent: "test-ai-sdk" });

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

      // Create run and get the native AI SDK stream
      const stream = await sendMessageViaTransport(
        org.prodClient.createTransport(), 
        session.id, 
        { id: "msg_1", role: "user", parts: [{ type: "text", text: "What is the answer?" }] }
      );

      await consumeChunksFromTransportStream(stream);

      // Verify final run state via API
      const finalSession = await org.prodClient.getSession({ id: session.id });
      expect(finalSession.messages[1].id).toBe("msg_assistant_1");
      expect(finalSession.messages[1].metadata).toMatchObject({
        a: "aaa",
        b: { bb: "xxx" },
        c: 100,
      });
    }, 10000);

    test("tools inputs are objects, partial tool call is object too", async () => {
      await org.prodStandardClient.updateEnvironment({ config: buildConfig() });
      const session = await org.prodClient.createSession({ agent: "test-ai-sdk" });

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

      // Create run and get the native AI SDK stream
      const stream = await sendMessageViaTransport(
        org.prodClient.createTransport(), 
        session.id, 
        { id: "msg_1", role: "user", parts: [{ type: "text", text: "What is the answer?" }] }
      );

      await consumeChunksFromTransportStream(stream);

      // Verify final run state via API
      const finalSession = await org.prodClient.getSession({ id: session.id });
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

    }, 10000);

    describe("local env (tunnel)", () => {
      // These tests exercise the backend's local-env path:
      //  - when no tunnel is registered, runs must 400
      //  - when a tunnel is registered, the backend POSTs to the tunnel URL
      //    and sets X-Target-Url to the actual agent URL (the real proxy then
      //    forwards to that URL; we don't test the proxy itself here).
      const TUNNEL_PORT = 3460;
      const TUNNEL_URL = `http://localhost:${TUNNEL_PORT}`;

      let mockTunnel: MockServer | null = null;

      beforeAll(async () => {
        mockTunnel = await createMockServer(TUNNEL_PORT);
      });

      afterAll(async () => {
        if (mockTunnel) {
          await mockTunnel.close();
          mockTunnel = null;
        }
      }, 10000);

      beforeEach(() => {
        mockTunnel?.resetRequests();
      });

      test("local env without tunnel → 400 error from run", async () => {
        await org.admin.localStandardClient.updateEnvironment({ config: buildConfig(), tunnelUrl: null });

        const session = await org.admin.localClient.createSession({ agent: "test-ai-sdk" });
        const promise = org.admin.localClient.createRun({ sessionId: session.id, input: { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hello" }] } });

        await expect(promise).rejects.toBeInstanceOf(AgentViewError);
        expectToFail(promise, 400)

      }, 10000);

      test("local env with tunnel → backend POSTs to tunnel URL with X-Target-Url header", async () => {
        await org.admin.localStandardClient.updateEnvironment({ tunnelUrl: TUNNEL_URL });

          // Mock tunnel stands in for cloudflared + proxy. It receives the forwarded
          // request and responds with a valid AI SDK stream (as the proxy would).
          mockTunnel!.setHandler((_body, res) => {
            writeAISDKSuccessHeaders(res);
            writeAISDKChunks(res, [
              { type: "start" },
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "via tunnel" },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: "stop" },
            ]);
            writeAISDKDone(res);
            res.end();
          });

          const session = await org.admin.localClient.createSession({ agent: "test-ai-sdk" });

          const stream = await sendMessageViaTransport(
            org.admin.localClient.createTransport(),
            session.id,
            { id: "msg_1", role: "user", parts: [{ type: "text", text: "Hello" }] }
          );

          const chunks = await consumeChunksFromTransportStream(stream);
          const textDeltas = chunks.filter(c => c.type === "text-delta");
          expect(textDeltas.map(d => d.delta).join("")).toBe("via tunnel");

          // The mock tunnel must have received exactly one POST with X-Target-Url = agent URL
          expect(mockTunnel!.requests.length).toBe(1);
          const received = mockTunnel!.requests[0];
          expect(received.headers['x-target-url']).toBe(AI_SDK_AGENT_URL);
          // Body should be the normal upstream agent request body
          expect(received.body.messages).toBeDefined();
          expect(Array.isArray(received.body.messages)).toBe(true);
          expect(received.body.messages[0].parts[0].text).toBe("Hello");

      }, 10000);

      test("setting tunnelUrl on production env → 400 error", async () => {
        await expect(
          org.prodStandardClient.updateEnvironment({ tunnelUrl: TUNNEL_URL })
        ).rejects.toThrowError(expect.objectContaining({
          statusCode: 400,
          message: expect.stringContaining("production"),
        }));
      }, 10000);
    });

  });


});