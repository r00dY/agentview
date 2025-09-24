import type { AgentViewConfig } from "../types";
import * as z from "zod"
import type { BaseConfig } from "./shared/configTypes";


export function serializeBaseConfig(config: BaseConfig): any {
  return serializeObject(config);
}

export function getBaseConfig(config: AgentViewConfig): BaseConfig {
  return {
    sessions: (config.sessions ?? []).map((session) => ({
      type: session.type,
      url: session.url,
      metadata: session.metadata,
      items: session.items.map((item) => ({
      type: item.type,
        role: item.role,
        content: item.content,
        scores: item.scores?.map((score) => ({
          name: score.name,
          schema: score.schema,
          options: filterOutReactAndFunctions(score.options)
        }))
      }))
    }))
  }
}

function serializeObject(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle Zod schemas
  if (obj instanceof z.ZodType) {
    return z.toJSONSchema(obj);
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(serializeObject);
  }

  // Handle objects
  if (typeof obj === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (isFunction(value) || isReactComponent(value)) {
        continue;
      }
      result[key] = serializeObject(value);
    }
    return result;
  }

  // Primitives
  return obj;
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
