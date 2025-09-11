import type { BaseScoreConfig, BaseActivityConfig, BaseThreadConfig, BaseConfig } from "./lib/shared/configTypes";

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

export type ActivityConfig = BaseActivityConfig<ScoreConfig> & {
  isInput?: boolean;
  input?: React.ComponentType<FormInputProps>;
  options?: any;
};

export type ThreadConfig = BaseThreadConfig<ActivityConfig>;
  
export type AgentViewConfig = {
  threads: ThreadConfig[],  
}
