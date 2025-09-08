import { config } from "../../agentview.config";
import type { AgentViewConfig } from "../types";
import * as z from "zod"
import type { BaseConfig } from "./shared/configTypes";


export function serializeBaseConfig(config: BaseConfig): any {
  return {
    threads: config.threads.map((thread) => ({
      ...thread,
      metadata: thread.metadata ? z.toJSONSchema(thread.metadata) : undefined,
      activities: thread.activities.map((activity) => ({
        ...activity,
        content: z.toJSONSchema(activity.content),
        scores: activity.scores?.map((score) => ({
          ...score,
          schema: z.toJSONSchema(score.schema),
        }))
      }))
    }))
  }
}

export function getBaseConfig(config: AgentViewConfig): BaseConfig {
  return {
    threads: config.threads.map((thread) => ({
      type: thread.type,
      metadata: thread.metadata,
      activities: thread.activities.map((activity) => ({
        type: activity.type,
        role: activity.role,
        content: activity.content,
        scores: activity.scores?.map((score) => ({
          name: score.name,
          schema: score.schema,
          options: filterOutReactAndFunctions(score.options)
        }))
      }))
    }))
  }
}

// Helper function to check if a value is a React component
function isReactComponent(value: any): boolean {
  return typeof value === 'function' && (
    value.displayName ||
    value.name?.startsWith('React') ||
    value.$$typeof === Symbol.for('react.element') ||
    value.$$typeof === Symbol.for('react.memo') ||
    value.$$typeof === Symbol.for('react.forward_ref')
  );
}

// Helper function to check if a value is a function (excluding React components)
function isFunction(value: any): boolean {
  return typeof value === 'function' && !isReactComponent(value);
}

// Helper function to recursively filter out functions and React components
function filterOutReactAndFunctions(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(filterOutReactAndFunctions);
  }

  if (typeof obj === 'object') {
    const filtered: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (isFunction(value) || isReactComponent(value)) {
        // Skip functions and React components
        continue;
      }
      filtered[key] = filterOutReactAndFunctions(value);
    }
    return filtered;
  }

  return obj;
}
