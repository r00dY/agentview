function getBasename(): string {
  return (window as any).agentview?.basename || '/';
}

/**
 * Strip the studio router's basename from a path. Returns the path without
 * basename, or the original path unchanged if it doesn't sit under basename.
 * Mirrors react-router's internal `stripBasename` (which isn't exported at runtime).
 */
export function stripBasename(pathname: string, basename: string = getBasename()): string {
  if (basename === "/") return pathname;
  if (!pathname.toLowerCase().startsWith(basename.toLowerCase())) {
    return pathname;
  }
  const startIndex = basename.endsWith("/") ? basename.length - 1 : basename.length;
  const nextChar = pathname.charAt(startIndex);
  if (nextChar && nextChar !== "/") {
    return pathname;
  }
  return pathname.slice(startIndex) || "/";
}
