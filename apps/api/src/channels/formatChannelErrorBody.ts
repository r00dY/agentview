/** Markdown body used wherever we surface an error to a channel/inbox. */
export function formatChannelErrorBody(error: unknown): string {
  const message =
    error instanceof Error ? error.message :
    typeof error === 'string' ? error :
    (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string')
      ? (error as { message: string }).message :
    String(error);
  return `### Error\n\n${message}`;
}
