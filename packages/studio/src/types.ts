import type { RouteObject } from "react-router";
import type { BaseScoreConfig, BaseSessionItemConfig, BaseAgentConfig, BaseAgentViewConfig, BaseRunConfig, BaseChannelConfig } from "agentview/baseConfigTypes";
import type { StandardRun, StandardSession, SessionBase, SessionItem } from "agentview/apiTypes";
import { enhanceSession } from "agentview/sessionUtils";
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

export type FormComponentProps<TSchema extends z.ZodTypeAny> = {
  value?: z.infer<TSchema> | undefined, 
  submit: (value: z.infer<TSchema> | null) => void,
  cancel: () => void,
  isRunning: boolean,
  error?: any,
  schema: TSchema,
}

export type FormComponent<TSchema extends z.ZodTypeAny> = React.ComponentType<FormComponentProps<TSchema>>;

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

export type SessionItemDisplayComponentProps<TItemSchema extends z.ZodTypeAny = z.ZodAny> = {
  item: z.infer<TItemSchema>,
  resultItem?: any, // fixme
  sessionItem: SessionItem;
  run: StandardRun;
  session: StandardSession;
}

export type SessionItemConfig = BaseSessionItemConfig<ScoreConfig> & {
  displayComponent?: React.ComponentType<SessionItemDisplayComponentProps> | null;
  // disableLike?: boolean;
  // callResult?: SessionItemConfig;
};

export type RunConfig = BaseRunConfig<SessionItemConfig, SessionItemConfig> & {
  title?: string;
  displayProperties?: DisplayProperty<{ session: StandardSession, run: StandardRun }>[];
  disableLike?: boolean;
};

export type AgentInputComponentProps<TSchema extends z.ZodTypeAny = z.ZodAny> = {
  session: ReturnType<typeof enhanceSession>,
  token: string,
  isRunning: boolean,
  cancel: () => void,
  submit2: (items: any[]) => Promise<void>,
}

export type AgentInputComponent<TSchema extends z.ZodTypeAny = z.ZodAny> = React.ComponentType<AgentInputComponentProps<TSchema>>


export type NewSessionComponentProps = {
  submit: (values?: { metadata?: any }) => void,
  isRunning: boolean
}

export type NewSessionComponent = React.ComponentType<NewSessionComponentProps>

// export type ChannelConfig = BaseChannelConfig & {
//   displayProperties?: DisplayProperty<{ session: SessionBase }>[];
//   newSessionComponent?: NewSessionComponent;
//   inputComponent?: AgentInputComponent;
// }

export type AgentConfig = BaseAgentConfig<RunConfig> & {
  displayProperties?: DisplayProperty<{ session: SessionBase }>[];
  newSessionComponent?: NewSessionComponent;
  inputComponent?: AgentInputComponent;
}

export type AgentViewConfig = BaseAgentViewConfig<AgentConfig> & {
  publicApiKey: string;
  env: string; // required for playground, we know which environment to use
  customRoutes?: CustomRoute[],
}
