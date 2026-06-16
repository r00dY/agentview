import type { BaseScoreConfig, BaseAgentViewConfig, SharedAgentConfig } from "agentview/baseConfigTypes";
import type { AgentViewClient, Session, SessionBase } from "agentview";
import type { UIMessage } from "ai";
import type { CachedAgentViewClient } from "./lib/cached-agentview";

export type CustomRoute = {
  title: React.ReactNode;
  path: string;
  Component: React.ComponentType;
}

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
  runFooterComponent?: ControlComponent<TValue>;
}

export type InputUIMessage = string | (Omit<UIMessage, 'id' | 'role'> & { role?: 'user', id?: string });

export type AgentInputComponentProps = {
  session: Session,
  isRunning: boolean,
  cancel: () => void,
  sendMessage: (userMessage: InputUIMessage) => Promise<void>,
}

export type AgentInputComponent = React.ComponentType<AgentInputComponentProps>

export type NewSessionComponentProps = {
  client: CachedAgentViewClient,
  agent: string,
  redirectToSession: (sessionId: string) => void,
}

export type NewSessionComponent = React.ComponentType<NewSessionComponentProps>

export type AssistantMessagePartConfig<TPart = UIMessage['parts'][number]> =
  TPart extends { type: infer TType } ? {
    type: TType,
    displayComponent?: React.ComponentType<{ value: TPart, session: Session }> | null;
  } : never;


export type UserMessageDisplayComponent = React.ComponentType<{ value: UIMessage, session: Session }>;

export interface AgentConfig extends Omit<SharedAgentConfig, 'adapter'> {
  displayProperties?: DisplayProperty<{ session: SessionBase }>[];
  newSessionComponent?: NewSessionComponent;
  inputComponent?: AgentInputComponent;

  run?: {
    userMessage?: {
      displayComponent?: UserMessageDisplayComponent | null;
    }
    assistantMessage?: {
      parts?: AssistantMessagePartConfig[];
    }

    displayProperties?: DisplayProperty<{ session: Session, userMessage: UIMessage, assistantMessage: UIMessage }>[];
    disableLike?: boolean;
    scores?: ScoreConfig[];
  }
}

export type AgentViewConfig = BaseAgentViewConfig<AgentConfig> & {
  publicApiKey: string;
  env: string; // required for playground, we know which environment to use
  customRoutes?: CustomRoute[],
}

