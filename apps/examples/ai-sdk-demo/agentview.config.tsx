import { AssistantMessage, Colors, Step, StepContent, StepTitle, UserMessage, UserMessageInput, multiSelect, select } from "@agentview/studio";
import { Button } from "@agentview/studio/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@agentview/studio/components/ui/select";
import { defineConfig } from "@agentview/studio";
import { Book, Brain } from "lucide-react";
import * as React from "react";
import { z } from "zod";
import { CustomPage } from "./components/CustomPage";

export default defineConfig({
  organizationId: process.env.NEXT_PUBLIC_AGENTVIEW_ORGANIZATION_ID!,
  env: process.env.NEXT_PUBLIC_AGENTVIEW_ENV!,
  channels: [
    {
      type: "gmail",
      address: "agentviewtest@gmail.com",
      agent: "weather-chat",
    },
    {
      type: "api",
      name: "test",
      agent: "weather-chat",
      metadata: {
        userLocation: z.string().nullable()
      },
      inputComponent: ({ submit2, cancel, isRunning, session, token }) => <UserMessageInput
        onSubmit={(val) => {
          submit2([{
            type: "message",
            role: "user",
            parts: [
              {
                type: "text",
                text: val,
              }
            ]
          }])
        }}
        onCancel={cancel}
        isRunning={isRunning}
      />,
      displayProperties: [
        {
          title: "User Location",
          value: ({ session }) => session?.metadata?.userLocation
        }
      ]
    },
    {
      type: "api",
      name: "weather-chat",
      agent: "weather-chat",
      metadata: {
        userLocation: z.string().nullable()
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
      inputComponent: ({ submit2, cancel, isRunning, session, token }) => <UserMessageInput
        onSubmit={(val) => {
          submit2([{
            type: "message",
            role: "user",
            parts: [
              {
                type: "text",
                text: val,
              }
            ]
          }])
        }}
        onCancel={cancel}
        isRunning={isRunning}
      />
    }
  ],
  agents: [
    {
      name: "weather-chat",
      version: "0.0.2",
      url: "http://localhost:3000/api/chat",
      adapter: "ai-sdk",
      runs: [
        {
          input: {
            schema: z.looseObject({
              role: z.literal("user"),
              parts: z.array(z.object({
                type: z.literal("text"),
                text: z.string(),
              })),
            }),
            displayComponent: ({ item }) => {
              return <UserMessage>{item.parts?.map((part: any) => part.text).join("\n\n")}</UserMessage>;
            },
          },
          steps: [
            {
              schema: z.looseObject({
                type: z.literal("reasoning"),
                text: z.string(),
              }),
              displayComponent: ({ item }) => {
                const textNormalized = item.text?.trim() == "" ? null : item.text;

                return <Step collapsible>
                  <StepTitle><Brain /> Thinking</StepTitle>
                  <StepContent>
                    {textNormalized ?? "Empty."}
                  </StepContent>
                </Step>
              }
            },
            {
              schema: z.looseObject({
                type: z.literal("data-weather"),
                data: z.any(),
              }),
              displayComponent: ({ item }) => {
                return <Step>
                  <StepTitle><Brain /> Weather</StepTitle>
                  <StepContent>
                    {item.data.location} {item.data.temperature}°C
                  </StepContent>
                </Step>
              }
            },
            {
              schema: z.looseObject({
                type: z.literal("data-status"),
                data: z.any(),
              }),
              displayComponent: ({ item }) => {
                return <Step collapsible>
                  <StepTitle><Brain /> Status</StepTitle>
                  <StepContent>
                    {item.data}
                  </StepContent>
                </Step>
              }
            },
            // { 
            //   schema: z.looseObject({
            //     type: z.literal("function_call"),
            //     name: z.literal("weather_tool"),
            //     callId: z.string().meta({ callId: true }),
            //   }),
            //   callResult: {
            //     schema: z.looseObject({
            //       type: z.literal("function_call_result"),
            //       callId: z.string().meta({ callId: true }),
            //     })
            //   },
            //   displayComponent: WeatherItem
            // }
          ],
          output: {
            // schema: z.looseObject({
            //   type: z.literal("text"),
            //   text: z.string(),
            // }),
            schema: z.any(),
            displayComponent: ({ item }) => <AssistantMessage>{item.text}</AssistantMessage>,
          },
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
          // displayProperties: [
          //   {
          //     title: "Input tokens",
          //     value: ({ run }) => run?.metadata?.usage?.inputTokens
          //   },
          //   {
          //     title: "Output tokens",
          //     value: ({ run }) => run?.metadata?.usage?.outputTokens
          //   }
          // ]
        },
      ],
      // inputComponent: ({ submit2, cancel, isRunning, session, token }) => <UserMessageInput
      //   onSubmit={(val) => {
      //     submit2([{
      //       type: "message",
      //       role: "user",
      //       parts: [
      //         {
      //           type: "text",
      //           text: val,
      //         }
      //       ]
      //     }])
      //   }}
      //   onCancel={cancel}
      //   isRunning={isRunning}
      // />
    }
  ],
  customRoutes: [
    {
      type: "agent",
      agent: "weather-chat",
      title: <><Book className="size-4" /> <span>Custom Page</span></>,
      route: {
        path: "/custom-page",
        Component: CustomPage
      }
    }
  ]
});