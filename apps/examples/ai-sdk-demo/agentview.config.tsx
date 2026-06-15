import { AssistantMessage, Colors, Step, StepContent, StepTitle, UserMessage, UserMessageInput, multiSelect, select } from "@agentview/studio";
import { Button } from "@agentview/studio/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@agentview/studio/components/ui/select";
import { defineConfig } from "@agentview/studio";
import { Book, Brain, CloudRain, ThermometerSun } from "lucide-react";
import * as React from "react";
import { z } from "zod";
import { CustomPage } from "./components/CustomPage";
import { NewSessionComponent, NewSessionComponentProps } from "../../../packages/studio/src/types";


export default defineConfig({
  publicApiKey: process.env.NEXT_PUBLIC_AGENTVIEW_PUBLIC_API_KEY!,
  env: process.env.NEXT_PUBLIC_AGENTVIEW_ENV!,
  agents: [
    {
      name: "weather-chat-2",
      version: "0.0.1",
      url: "http://localhost:3000/api/manual",
    },
    {
      name: "weather-chat",
      version: "0.0.2",
      url: "http://localhost:3000/api/chat-simple",

      metadata: {
        userLocation: z.string()
      },
      displayProperties: [
        {
          title: "User Location",
          value: ({ session }) => session?.metadata?.userLocation
        }
      ],
      
      newSessionComponent: WeatherChatNewSessionComponent,
      // inputComponent: ({ sendMessage, cancel, isRunning, session }) => <UserMessageInput
      //   onSubmit={(val) => {
      //     sendMessage({
      //       parts: [
      //         {
      //           type: "text",
      //           text: val,
      //         }
      //       ]
      //     })
      //   }}
      //   onCancel={cancel}
      //   isRunning={isRunning}
      // />,

      // userMessage: {
      //   displayComponent: ({ value }) => {
      //     return <UserMessage>CUSTOM: {value.parts?.map((part: any) => part.text).join("\n\n")}</UserMessage>;
      //   },
      // },

      run: {
        // userMessage: {
        //   displayComponent: ({ value }) => {
        //     return <UserMessage>CUSTOM: {value.parts?.map((part: any) => part.text).join("\n\n")}</UserMessage>;
        //   },
        // },
        assistantMessage: {
          parts: [
            {
              type: "data-weather",
              displayComponent: ({ value }) => {
                return <Step collapsible>
                  <StepTitle><ThermometerSun /> Weather Data</StepTitle>
                  <StepContent>{value.data as any}</StepContent>
                </Step>
              },
            }
          ]
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
        ],

        displayProperties: [
          {
            title: "Random",
            value: ({ assistantMessage }) => assistantMessage?.metadata?.random ?? "unknown"
          }
        ]
      },
      channels: [
        {
          type: "agentview-email",
          metadata: {
            userLocation: "Warsaw"
          }
        },
        {
          type: "gmail",
          address: "agentviewtest@gmail.com2",
        }
      ]
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


const cities = [
  "New York",
  "London",
  "Tokyo",
  "Paris",
  "Warsaw"
];

function WeatherChatNewSessionComponent({ client, agent, redirectToSession }: NewSessionComponentProps) {
  const [selectedCity, setSelectedCity] = React.useState<string>("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const { user } = await client.users.createAnon();
      const session = await client.sessions.create({
        agent,
        active: false,
        metadata: { userLocation: selectedCity },
        userId: user.id
      });

      redirectToSession(session.id);
  };

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
      <Button type="submit">Create Session</Button>
    </form>
  );
}