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
  input: React.ComponentType<FormInputProps<T>>;
  display: React.ComponentType<DisplayComponentProps<T>>;
}

export type SessionItemConfig = BaseSessionItemConfig<ScoreConfig> & {
  isInput?: boolean;
  input?: React.ComponentType<FormInputProps>;
  display: React.ComponentType<DisplayComponentProps>;
  title?: string;
  options?: any;
};

export type AgentConfig = BaseAgentConfig<SessionItemConfig>;
  
export type AgentViewConfig = {
  agents?: AgentConfig[],  
}
