import { openai } from "@ai-sdk/openai";
import { type SessionBase } from "agentview";
import { weatherTool } from "@/lib/weatherTool";

import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  UIMessage,
} from "ai";

export async function POST(req: Request) {
  const { messages, session }: { messages: UIMessage[], session: SessionBase } = await req.json();

  const result = streamText({
    model: openai("gpt-5-mini"),
    system:
      `You are a helpful assistant with access to a weather tool. When the user asks about weather, use the tool to get real data. Be concise.`,
    messages: await convertToModelMessages(messages),
    tools: { weather: weatherTool },
    stopWhen: stepCountIs(5)
  });

  return result.toUIMessageStreamResponse();
}
