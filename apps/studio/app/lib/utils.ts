import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isAsyncIterable(obj: any) {
  return obj != null && typeof obj[Symbol.asyncIterator] === 'function';
}

/**
 * Extracts mentions from comment content in the format @[property:value]
 * Currently supports: user_id
 * @param content The comment content to parse
 * @returns Dictionary where key is property and value is array of values
 * @throws Error if @[...] format is invalid
 */
export function extractMentions(content: string): Record<string, string[]> {
  if (content === null || content === undefined) {
    return {};
  }

  const mentionRegex = /@\[([^\]]+)\]/g;
  const mentions: Record<string, string[]> = {};
  let match;
  
  while ((match = mentionRegex.exec(content)) !== null) {
    const inside = match[1];
    
    // Parse property:value format
    const colonIndex = inside.indexOf(':');
    if (colonIndex === -1) {
      throw new Error(`Invalid mention format: @[${inside}]. Expected format: @[property:value]`);
    }
    
    const property = inside.substring(0, colonIndex).trim();
    const value = inside.substring(colonIndex + 1).trim();
    
    // Validate property
    if (property !== 'user_id') {
      throw new Error(`Unsupported mention property: ${property}. Only 'user_id' is currently supported.`);
    }
    
    // Validate value is not empty
    if (!value) {
      throw new Error(`Invalid mention value for property ${property}: empty value`);
    }
    
    // Add to mentions dictionary
    if (!mentions[property]) {
      mentions[property] = [];
    }
    
    // Avoid duplicates
    if (!mentions[property].includes(value)) {
      mentions[property].push(value);
    }
  }
  
  return mentions;
}

// Example usage:
// extractMentions("Hello @[user_id:abc123] and @[user_id:def456]!") 
// Returns: { "user_id": ["abc123", "def456"] }


export function getThreadsList(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get('list') ?? "real";
  const allowedTypes = ["simulated_shared", "simulated_private", "real"];

  if (!allowedTypes.includes(type)) {
    throw new Error(`Invalid thread type: ${type}. Allowed types are: ${allowedTypes.join(", ")}`);
  }

  return type
}
