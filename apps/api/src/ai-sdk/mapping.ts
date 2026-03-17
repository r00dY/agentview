import type { Session, UIMessage } from 'agentview/apiTypes';

/**
 * Converts an AgentView session (with runs and items) to UIMessage array for the AI SDK request body.
 *
 * For each run:
 * - Input items (type='input', or positional fallback: first item) → squashed into one user message
 * - Output items (type='output', or positional fallback: remaining items) → assistant message
 *
 * For the current run (last run, status=in_progress): only include the user message.
 */
export function sessionToUIMessages(session: Session): UIMessage[] {
  const messages: UIMessage[] = [];

  for (const run of session.runs) {
    const items = run.sessionItems;
    if (items.length === 0) continue;

    // Split items by type field, with positional fallback for NULL type
    const hasTypedItems = items.some(item => item.type != null);
    const inputItems = hasTypedItems
      ? items.filter(item => item.type === 'input')
      : [items[0]];
    const outputItems = hasTypedItems
      ? items.filter(item => item.type === 'output' || item.type === 'step')
      : items.slice(1);

    // Squash all input items into one user message  by collecting all their parts
    const userParts: any[] = [];
    for (const inputItem of inputItems) {
      const inputContent = inputItem.content;
      if (Array.isArray(inputContent.parts)) {
        userParts.push(...inputContent.parts);
      } else {
        userParts.push({ type: 'text', text: typeof inputContent === 'string' ? inputContent : (inputContent.content ?? JSON.stringify(inputContent)) });
      }
    }

    const firstInputItem = inputItems[0];
    const userMessage: UIMessage = {
      id: firstInputItem.id,
      role: 'user',
      parts: userParts,
    };
    if (firstInputItem.content?.metadata) {
      userMessage.metadata = firstInputItem.content.metadata;
    }
    messages.push(userMessage);

    // For in_progress runs (current run), only include the user message
    if (run.status === 'in_progress') {
      continue;
    }

    // Output items → assistant message parts
    if (outputItems.length > 0) {
      const assistantParts = outputItems.map(item => item.content);
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
