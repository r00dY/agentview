import type { z } from "zod";

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

export interface ScoreConfig<T=any> {
  name: string;
  title?: string;
  schema: z.ZodType;
  input: React.ComponentType<FormInputProps<T>>;
  display: React.ComponentType<DisplayComponentProps<T>>;
  options?: any
}

export interface ActivityConfig {
  type: string;
  role: string;
  content: z.ZodType;
  scores?: ScoreConfig[];
}

export interface ThreadConfig {
  name: string;
  metadata?: z.ZodType;
  activities: ActivityConfig[];
}
  
export type AgentViewConfig = {
  threads: ThreadConfig[],
}
