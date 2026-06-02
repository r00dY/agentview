import { AssistantMessage, Colors, UserMessage, UserMessageInput, Step, StepContent, StepTitle, multiSelect, select } from "@agentview/studio";
import { Button } from "@agentview/studio/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@agentview/studio/components/ui/select";
import { defineConfig } from "agentview";
import { Book, Brain } from "lucide-react";
import * as React from "react";
import { z } from "zod";
import { CustomPage } from "./src/CustomPage";
import { WeatherItem } from './src/WeatherItem';

export default defineConfig({
  organizationId: import.meta.env.VITE_AGENTVIEW_ORGANIZATION_ID,
  agents: [
    {
      name: "weather-chat",
      metadata: {
        userLocation: z.string()
      },
      newSessionComponent: ({ submit, isRunning }) => {
        const [selectedCity, setSelectedCity] = React.useState<string>("");

        const handleSubmit = (e: React.FormEvent) => {
          e.preventDefault();
          if (selectedCity) {
            submit({ metadata: { userLocation: selectedCity } });
          }
        };

        const cities = [
          "New York",
          "London",
          "Tokyo",
          "Paris",
          "Warsaw"
        ];

        return (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Select value={selectedCity} onValueChange={setSelectedCity}>
              <SelectTrigger>
                <SelectValue placeholder="Select a city" />
              </SelectTrigger>
              <SelectContent>
                {cities.map((city) => (
                  <SelectItem key={city} value={city}>
                    {city}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="submit"
              disabled={!selectedCity || isRunning}
            >
              {isRunning ? "Creating session..." : "Create Session"}
            </Button>
          </form>
        );
      },
      displayProperties: [
        {
          title: "User Location",
          value: ({ session }) => session?.metadata?.userLocation
        }
      ],
      runs: [
        {
          input: {
            schema: z.object({
              type: z.literal("message"),
              role: z.literal("user"),
              content: z.string(),
            }),
            displayComponent: ({ item }) => <UserMessage>{item.content}</UserMessage>,
          },
          steps: [
            {
              schema: z.looseObject({
                type: z.literal("reasoning"),
                content: z.array(z.object({
                  type: z.literal("input_text"),
                  text: z.string(),
                })),
              }),
              displayComponent: ({ item }) => <Step collapsible>  
                <StepTitle><Brain /> Thinking</StepTitle>
                <StepContent>
                  {item.content?.map((s: any) => s?.text ?? "").join("\n\n") ?? "Hidden reasoning summary."}
                </StepContent>
              </Step>
            },
            { 
              schema: z.looseObject({
                type: z.literal("function_call"),
                name: z.literal("weather_tool"),
                callId: z.string().meta({ callId: true }),
              }),
              callResult: {
                schema: z.looseObject({
                  type: z.literal("function_call_result"),
                  callId: z.string().meta({ callId: true }),
                })
              },
              displayComponent: WeatherItem
            }
          ],
          output: {
            schema: z.looseObject({
              type: z.literal("message"),
              role: z.literal("assistant"),
              content: z.array(z.object({
                type: z.literal("output_text"),
                text: z.string(),
              })),
            }),
            displayComponent: ({ item }) => <AssistantMessage>{item.content.map((c: any) => c?.text ?? "").join("\n\n")}</AssistantMessage>,
            scores: [
              select({
                name: "forecast_accuracy",
                title: "Forecast Accuracy",
                options: [
                  { value: "accurate", label: "Accurate", color: Colors.green },
                  { value: "partially_accurate", label: "Partially Accurate", color: Colors.yellow },
                  { value: "inaccurate", label: "Inaccurate", color: Colors.red },
                ]
              }),
              multiSelect({
                name: "style",
                title: "Style",
                options: [
                  { value: "too-long", label: "Too long" },    
                  { value: "too-brief", label: "Too brief" },
                  { value: "confusing", label: "Confusing" },
                  { value: "overly-technical", label: "Overly technical" },
                ]
              })
            ]
          },
          displayProperties: [
            {
              title: "Input tokens",
              value: ({ run }) => run?.metadata?.usage?.inputTokens
            },
            {
              title: "Output tokens",
              value: ({ run }) => run?.metadata?.usage?.outputTokens
            }
          ]
        }
      ],
      inputComponent: ({ submit, cancel, isRunning, session, token }) => <UserMessageInput
        onSubmit={(val) => {
          submit("http://localhost:3000/weather-chat", {
            id: session.id,
            token,
            input: {
              type: "message",
              role: "user",
              content: val,
            }
          })
        }}
        onCancel={cancel}
        isRunning={isRunning}
      />
    }
  ],
  customRoutes: [
    {
      title: <><Book className="size-4" /> <span>Custom Page</span></>,
      path: "/custom-page",
      Component: CustomPage
    }
  ]
});