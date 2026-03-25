import { openai } from "@ai-sdk/openai";
import { SessionBase } from "agentview";

import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  tool,
  UIMessage,
  Output
} from "ai";
import { z } from "zod";

function weatherCodeToDescription(code: number): string {
  const descriptions: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snowfall",
    73: "Moderate snowfall",
    75: "Heavy snowfall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
  };
  return descriptions[code] ?? "Unknown";
}

const weatherTool = tool({
  description: "Get weather information for a location using Open-Meteo",
  inputSchema: z.object({
    location: z.string().describe("The city name to get weather for"),
  }),
  execute: async ({ location }) => {
    // Step 1: Geocode the city name
    const geoResponse = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`
    );
    if (!geoResponse.ok) {
      return { error: "Failed to geocode location" };
    }
    const geoData = await geoResponse.json();
    const place = geoData.results?.[0];
    if (!place) {
      return { error: `Location "${location}" not found` };
    }

    // Step 2: Fetch current weather
    const weatherResponse = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m`
    );
    if (!weatherResponse.ok) {
      return { error: "Failed to fetch weather data" };
    }
    const weatherData = await weatherResponse.json();
    const current = weatherData.current;
    const tempC = current.temperature_2m;

    return {
      location: place.name,
      temperature_c: String(Math.round(tempC)),
      temperature_f: String(Math.round(tempC * 9 / 5 + 32)),
      description: weatherCodeToDescription(current.weather_code),
      humidity: String(current.relative_humidity_2m),
      wind_speed_kmph: String(Math.round(current.wind_speed_10m)),
    };
  },
});

export async function POST(req: Request) {
  const { messages, session }: { messages: UIMessage[], session: SessionBase } = await req.json();

  console.log('New request received', session.id, messages[messages.length - 1]);

  // console.log('[chat] messages: ', JSON.stringify(messages, null, 2));
  // console.log('[chat] session: ', session);

  await new Promise(resolve => setTimeout(resolve, 5000));

  const userLocation = session?.metadata?.userLocation;

  const result = streamText({
    model: openai("gpt-5-mini"),
    system:
      `You are a helpful assistant with access to a weather tool. When the user asks about weather, use the tool to get real data. Be concise!` + (userLocation ? ` The user is currently at location: ${userLocation}.` : ''),
    messages: await convertToModelMessages(messages),
    tools: { weather: weatherTool },
    stopWhen: stepCountIs(5),
    onChunk({ chunk }) {
      console.log('chunk received', chunk.type)
      // if (!wasFirstChunkSent) {
      //   wasFirstChunkSent = true;
      //   console.log('First chunk sent');
      // }

      // if (chunk.type === "text-delta") {
      //   process.stdout.write(chunk.text);
      // } else if (chunk.type === "tool-call") {
      //   console.log(
      //     `\n[tool-call] ${chunk.toolName}(${JSON.stringify(chunk.input)})`
      //   );
      // } else if (chunk.type === "tool-result") {
      //   console.log(
      //     `[tool-result] ${chunk.toolName}: ${JSON.stringify(chunk.output)}`
      //   );
      // } else if (chunk.type === "reasoning-delta") {
      //   process.stdout.write(`[reasoning] ${chunk.text}`);
      // }
    },
    onStepFinish({ finishReason, text, toolCalls, usage }) {
      console.log(
        `\n[step-finish] reason=${finishReason} tools=${toolCalls.length} text=${text.slice(0, 100)}`
      );
    },
    onFinish({ text, steps, usage }) {
      console.log(
        `[finish] steps=${steps.length} tokens=${JSON.stringify(usage)}`
      );
    },
    onError(error) {
      console.error(error);
    },

    experimental_telemetry: {
      isEnabled: true,
      metadata: {
        query: "weather",
        location: "San Francisco",
      },
    },
    // output: Output.object({
    //   schema: z.object({
    //     response: z.string(),
    //     is_user_happy: z.string()
    //   }),
    // }),
  });

  return result.toUIMessageStreamResponse({
    headers: {
      'X-AgentView-Version': '0.0.1',
    },
  });
}
