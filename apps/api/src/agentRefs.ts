import { eq, and } from 'drizzle-orm';
import { agentRefs, sessions } from './schemas/schema';
import { AgentViewError } from 'agentview/AgentViewError';
import type { Transaction } from './types';
import type { AgentRef } from 'agentview/apiTypes';

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  suffix?: string;
};

function parseVersion(version: string): ParsedVersion | undefined {
  const m = version.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-(.+))?$/);
  if (!m) return undefined;

  const major = Number(m[1]);
  const minor = m[2] !== undefined ? Number(m[2]) : 0;
  const patch = m[3] !== undefined ? Number(m[3]) : 0;
  const suffix = m[4];

  if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) return undefined;

  return { major, minor, patch, ...(suffix ? { suffix } : {}) };
}

function versionToString(version: ParsedVersion): string {
  return `${version.major}.${version.minor}.${version.patch}${version.suffix ? `-${version.suffix}` : ''}`;
}

function compareVersions(v1: ParsedVersion, v2: ParsedVersion): number {
  if (v1.major !== v2.major) return v1.major < v2.major ? -1 : 1;
  if (v1.minor !== v2.minor) return v1.minor < v2.minor ? -1 : 1;
  if (v1.patch !== v2.patch) return v1.patch < v2.patch ? -1 : 1;
  return 0;
}

/**
 * Simple upsert: inserts agent_ref row if not exists, returns the row.
 * No version comparison, no session update.
 */
export async function upsertAgentRef(tx: Transaction, opts: {
  agentRef: AgentRef;
  organizationId: string;
}): Promise<{ agentRefId: string; version: string; agent: string; adapter: 'agentview' | 'ai-sdk' }> {
  const parsed = parseVersion(opts.agentRef.version);
  if (!parsed) {
    throw new AgentViewError("Invalid version number format. Should be like '1.2.3' or '1.2.3-beta'", 422);
  }

  const version = versionToString(parsed);

  await tx.insert(agentRefs).values({
    organizationId: opts.organizationId,
    version,
    agent: opts.agentRef.agent,
    adapter: opts.agentRef.adapter,
  }).onConflictDoNothing();

  const [row] = await tx.select().from(agentRefs).where(and(eq(agentRefs.version, version), eq(agentRefs.agent, opts.agentRef.agent))).limit(1);

  return { agentRefId: row.id, version, agent: opts.agentRef.agent, adapter: opts.agentRef.adapter };
}

/**
 * Validates version against previous, upserts the agent_refs row,
 * and updates the session's agentRefs array.
 */
export async function resolveAgentRef(tx: Transaction, opts: {
  agentRef: AgentRef;
  previousAgentRef?: AgentRef | null;
  organizationId: string;
  sessionId: string;
}): Promise<{ agentRefId: string; version: string; agent: string; adapter: 'agentview' | 'ai-sdk' }> {
  const parsed = parseVersion(opts.agentRef.version);
  if (!parsed) {
    throw new AgentViewError("Invalid version number format. Should be like '1.2.3' or '1.2.3-beta'", 422);
  }

  const version = versionToString(parsed);

  if (opts.previousAgentRef) {
    const prevParsed = parseVersion(opts.previousAgentRef.version);
    if (!prevParsed) {
      throw new AgentViewError("Invalid version format in previous run.", 422);
    }

    if (prevParsed.major !== parsed.major) {
      throw new AgentViewError("Cannot continue a session with a different major version.", 422);
    }

    if (compareVersions(parsed, prevParsed) < 0) {
      throw new AgentViewError("Cannot continue a session with an older version.", 422);
    }
  }

  // Upsert agent ref row
  await tx.insert(agentRefs).values({
    organizationId: opts.organizationId,
    version,
    agent: opts.agentRef.agent,
    adapter: opts.agentRef.adapter,
  }).onConflictDoNothing();

  const [agentRefRow] = await tx.select().from(agentRefs).where(and(eq(agentRefs.version, version), eq(agentRefs.agent, opts.agentRef.agent))).limit(1);

  // Update session's agentRefs array if new
  const currentSession = await tx.query.sessions.findFirst({
    where: eq(sessions.id, opts.sessionId),
    columns: { agentRefs: true },
  });
  const existing = (currentSession?.agentRefs as { agent: string; version: string; adapter: "agentview" | "ai-sdk" }[]) ?? [];

  const alreadyExists = existing.some(ref => ref.agent === opts.agentRef.agent && ref.version === version);
  if (!alreadyExists) {
    await tx.update(sessions).set({
      agentRefs: [...existing, { agent: opts.agentRef.agent, version, adapter: opts.agentRef.adapter }],
      updatedAt: new Date().toISOString(),
    }).where(eq(sessions.id, opts.sessionId));
  }

  return { agentRefId: agentRefRow.id, version, agent: opts.agentRef.agent, adapter: opts.agentRef.adapter };
}
