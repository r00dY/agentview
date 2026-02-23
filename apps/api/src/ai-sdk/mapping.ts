import type { Session } from 'agentview/apiTypes';

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: any[];
  metadata?: any;
}

/**
 * Converts an AgentView session (with runs and items) to UIMessage array for the AI SDK request body.
 *
 * For each run:
 * - First item (input) → user message with text part extracted from content
 * - Remaining items → assistant message where each item's content IS a UIMessage part
 *
 * For the current run (last run, status=in_progress): only include the user message.
 */
export function sessionToUIMessages(session: Session): UIMessage[] {
  const messages: UIMessage[] = [];

  for (const run of session.runs) {
    const items = run.sessionItems;
    if (items.length === 0) continue;

    // First item is the input → user message
    const inputItem = items[0];
    const inputContent = inputItem.content;

    const userParts = Array.isArray(inputContent.parts)
      ? inputContent.parts
      : [{ type: 'text', text: typeof inputContent === 'string' ? inputContent : (inputContent.content ?? JSON.stringify(inputContent)) }];

    const userMessage: UIMessage = {
      id: inputItem.id,
      role: 'user',
      parts: userParts,
    };
    if (inputContent.metadata) {
      userMessage.metadata = inputContent.metadata;
    }
    messages.push(userMessage);

    // For in_progress runs (current run), only include the user message
    if (run.status === 'in_progress') {
      continue;
    }

    // Remaining items → assistant message parts
    if (items.length > 1) {
      const assistantParts = items.slice(1).map(item => item.content);
      const assistantMessage: UIMessage = {
        id: run.id,
        role: 'assistant',
        parts: assistantParts,
      };
      if (run.metadata) {
        assistantMessage.metadata = run.metadata;
      }
      messages.push(assistantMessage);
    }
  }

  return messages;
}
