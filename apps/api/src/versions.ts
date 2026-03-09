import { eq, and } from 'drizzle-orm';
import { versions, sessions } from './schemas/schema';
import { AgentViewError } from 'agentview/AgentViewError';
import type { Transaction } from './types';

export type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  suffix?: string;
};

export function parseVersion(version: string): ParsedVersion | undefined {
  // Accept version strings like '1.2.3', 'v1.2.3', '1', '1.2', possibly with suffixes like '-beta', '-alpha.1'
  // Normalize: '1' -> '1.0.0', '1.2' -> '1.2.0'
  const m = version.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-(.+))?$/);
  if (!m) return undefined;

  const major = Number(m[1]);
  const minor = m[2] !== undefined ? Number(m[2]) : 0;
  const patch = m[3] !== undefined ? Number(m[3]) : 0;
  const suffix = m[4];

  if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) return undefined;

  return { major, minor, patch, ...(suffix ? { suffix } : {}) };
}

export function versionToString(version: ParsedVersion): string {
  return `${version.major}.${version.minor}.${version.patch}${version.suffix ? `-${version.suffix}` : ''}`;
}

export function compareVersions(v1: ParsedVersion, v2: ParsedVersion): number {
  // Returns: -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
  // Note: Suffixes are ignored for comparison purposes
  if (v1.major !== v2.major) return v1.major < v2.major ? -1 : 1;
  if (v1.minor !== v2.minor) return v1.minor < v2.minor ? -1 : 1;
  if (v1.patch !== v2.patch) return v1.patch < v2.patch ? -1 : 1;
  return 0;
}

/**
 * Validates, normalizes, and stores a version. Used by both the POST /api/runs
 * handler (client-provided version) and the worker (agent-provided version via SSE).
 *
 * Returns { versionId, version } for the caller to use (e.g. set on the run row).
 */
export async function resolveVersion(tx: Transaction, opts: {
  versionString: string;
  agent: string;
  isProduction: boolean;
  isDev: boolean;
  lastRunVersion: string | null;
  organizationId: string;
  sessionId: string;
  existingSessionVersions?: string[];
}): Promise<{ versionId: string; version: string, agent: string }> {
  const parsedVersion = parseVersion(opts.versionString);
  if (!parsedVersion) {
    throw new AgentViewError("Invalid version number format. Should be like '1.2.3-xxx'", 422);
  }

  if (opts.isProduction && parsedVersion.suffix) {
    throw new AgentViewError("Production sessions can't have suffixed versions.", 422);
  }

  if (opts.isDev && !parsedVersion.suffix) {
    parsedVersion.suffix = 'dev';
  }

  if (opts.lastRunVersion) {
    const lastVersionParsed = parseVersion(opts.lastRunVersion);
    if (!lastVersionParsed) {
      throw new AgentViewError("Invalid version format in previous run.", 422);
    }

    if (lastVersionParsed.major !== parsedVersion.major) {
      throw new AgentViewError("Cannot continue a session with a different major version.", 422);
    }

    if (compareVersions(parsedVersion, lastVersionParsed) < 0) {
      throw new AgentViewError("Cannot continue a session with an older version.", 422);
    }
  }

  const version = versionToString(parsedVersion);

  // Upsert version row
  await tx.insert(versions).values({
    organizationId: opts.organizationId,
    version,
    agent: opts.agent,
  }).onConflictDoNothing();

  const [versionRow] = await tx.select().from(versions).where(and(eq(versions.version, version), eq(versions.agent, opts.agent))).limit(1);

  // Update session's versions array if new
  let existingVersions: string[];
  if (opts.existingSessionVersions) {
    existingVersions = opts.existingSessionVersions;
  } else {
    const currentSession = await tx.query.sessions.findFirst({
      where: eq(sessions.id, opts.sessionId),
      columns: { versions: true },
    });
    existingVersions = (currentSession?.versions as string[]) ?? [];
  }
  if (!existingVersions.includes(version)) {
    await tx.update(sessions).set({
      versions: [...existingVersions, version],
      updatedAt: new Date().toISOString(),
    }).where(eq(sessions.id, opts.sessionId));
  }

  return { versionId: versionRow.id, version, agent: opts.agent };
}
