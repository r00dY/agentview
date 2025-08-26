
export function isUUID(id: string): boolean {
  if (!id || typeof id !== 'string') {
    return false;
  }

  // UUID v4 regex pattern: 8-4-4-4-12 hexadecimal characters
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  
  return uuidRegex.test(id);
}
