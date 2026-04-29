import type { RouteObject } from "react-router";
import type { BaseScoreConfig, BaseAgentViewConfig, SharedAgentConfig } from "agentview/baseConfigTypes";
import type { AgentViewClient, Session, SessionBase } from "agentview";
import { z } from "zod";

export type RootCustomRoute = {
  type: "root",
  route: RouteObject;
}

export type AgentCustomRoute = {
  type: "agent",
  agent: string,
  title: React.ReactNode,
  route: RouteObject;
}

export type CustomRoute = RootCustomRoute | AgentCustomRoute;


export type DisplayProperty<TInputArgs = any> = {
  title: string;
  value: (args: TInputArgs) => React.ReactNode;
}

export type ControlComponentProps<TValue> = {
  value: TValue | undefined | null;
  onChange: (value: TValue | null) => void;
  name?: string;
  onBlur?: () => void;
  disabled?: boolean;
}

export type ControlComponent<TValue> = React.ComponentType<ControlComponentProps<TValue>>;

export type ScoreConfig<TValue = any> = BaseScoreConfig & {
  title?: string;
  inputComponent: ControlComponent<TValue>;
  displayComponent?: React.ComponentType<{ value: TValue }>;
  actionBarComponent?: ControlComponent<TValue>;
}

export type AgentInputComponentProps = {
  session: Session,
  isRunning: boolean,
  cancel: () => void,
  sendMessage: (userMessage: any) => Promise<void>,
}

export type AgentInputComponent = React.ComponentType<AgentInputComponentProps>

export type NewSessionComponentProps = {
  client: AgentViewClient,
  agent: string,
  redirectToSession: (sessionId: string) => void,
}

export type NewSessionComponent = React.ComponentType<NewSessionComponentProps>

export interface AgentConfig extends SharedAgentConfig {
  displayProperties?: DisplayProperty<{ session: SessionBase }>[];
  newSessionComponent?: NewSessionComponent;
  inputComponent?: AgentInputComponent;

  // custom fields for ai-sdk
  userMessage?: {
    displayComponent?: React.ComponentType<{ value: any, session: Session }>
  }
  assistantMessage?: {
      parts?: Array<{
          type: string,
          displayComponent?: React.ComponentType<{ value: any, session: Session }>
      }>
      displayProperties?: DisplayProperty<{ session: Session, userMessage: any, assistantMessage: any }>[];
      disableLike?: boolean;
      scores?: ScoreConfig[];
  }
}

export type AgentViewConfig = BaseAgentViewConfig<AgentConfig> & {
  publicApiKey: string;
  env: string; // required for playground, we know which environment to use
  customRoutes?: CustomRoute[],
}

