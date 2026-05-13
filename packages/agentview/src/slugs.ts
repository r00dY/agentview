const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function toSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function isValidSlug(input: string): boolean {
  return SLUG_REGEX.test(input);
}

export function emailToEnvSlug(email: string): string {
  const localPart = email.split('@')[0];
  return 'local-' + toSlug(localPart);
}
