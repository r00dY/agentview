import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isAsyncIterable(obj: any) {
  return obj != null && typeof obj[Symbol.asyncIterator] === 'function';
}

/**
 * Extracts user mentions from comment content in the format @[user_id:abcdef]
 * @param content The comment content to parse
 * @returns Array of user IDs that were mentioned
 */
export function extractMentions(content: string): string[] {
  const mentionRegex = /@\[user_id:([^\]]+)\]/g;
  const mentions: string[] = [];
  let match;
  
  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push(match[1]);
  }
  
  return [...new Set(mentions)]; // Remove duplicates
}

// Example usage:
// extractMentions("Hello @[user_id:abc123] and @[user_id:def456]!") 
// Returns: ["abc123", "def456"]
