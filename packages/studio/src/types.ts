import type { RouteObject } from "react-router";
import type { BaseScoreConfig, BaseSessionItemConfig, BaseAgentConfig, BaseConfig } from "./lib/shared/configTypes";

export type FormInputProps<T=any> = {
  id: string,
  name: string,
  value: T,
  onChange: (value: T) => void,
  options?: any
}

export type DisplayComponentProps<T=any> = {
  value: T,
  options?: any
}

export type ScoreConfig<T=any> = BaseScoreConfig & {
  title?: string;
  inputComponent: React.ComponentType<FormInputProps>;
  displayComponent: React.ComponentType<DisplayComponentProps>;
}

export type InputSessionItemConfig = BaseSessionItemConfig<ScoreConfig> & {
  input: true;
  title?: string;
  options?: any;
  inputComponent: React.ComponentType<FormInputProps>;
  displayComponent: React.ComponentType<DisplayComponentProps>;
};

export type StepSessionItemConfig = BaseSessionItemConfig<ScoreConfig> & {
  input?: false;
  title?: string;
  options?: any;
  displayComponent: React.ComponentType<DisplayComponentProps>;
};

export type SessionItemConfig = InputSessionItemConfig | StepSessionItemConfig;

export type CustomRoute = {
  route: RouteObject;
  scope: "default" | "loggedIn",
  title: React.ReactNode,
}

export type AgentConfig = BaseAgentConfig<SessionItemConfig>;
  
export type AgentViewConfig = {
  apiBaseUrl: string;
  agents?: AgentConfig[],
  customRoutes?: CustomRoute[],
}
