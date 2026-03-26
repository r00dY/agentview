import { eq, and } from 'drizzle-orm';
import { agentRefs, sessions } from './schemas/schema';
import { AgentViewError } from 'agentview/AgentViewError';
import type { Transaction } from './types';
import type { AgentRef } from 'agentview/apiTypes';
import type { OrgTransaction } from './withOrg';

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


export type InputAgentRef = {
  version: string;
  agent: string;
  adapter?: 'agentview' | 'ai-sdk';
}

/**
 * Simple upsert: inserts agent_ref row if not exists, returns the row.
 * No version comparison, no session update.
 */
export async function upsertAgentRef(tx: OrgTransaction, opts: {
  agentRef: InputAgentRef;
}): Promise<{ agentRefId: string; version: string; agent: string; adapter: 'agentview' | 'ai-sdk' }> {
  const parsed = parseVersion(opts.agentRef.version);
  if (!parsed) {
    throw new AgentViewError("Invalid version number format. Should be like '1.2.3' or '1.2.3-beta'", 422);
  }

  const version = versionToString(parsed);
  const agent = opts.agentRef.agent;
  const adapter = opts.agentRef.adapter ?? 'agentview';

  await tx.insert(agentRefs).values({
    organizationId: tx.organizationId,
    version,
    agent,
    adapter,
  }).onConflictDoNothing();

  const [row] = await tx.select().from(agentRefs).where(and(eq(agentRefs.version, version), eq(agentRefs.agent, agent), eq(agentRefs.adapter, adapter))).limit(1);

  return { agentRefId: row.id, version, agent, adapter };
}

/**
 * Validates version against previous, upserts the agent_refs row,
 * and updates the session's agentRefs array.
 */
export async function resolveAgentRef(tx: OrgTransaction, opts: {
  agentRef: InputAgentRef;
  previousAgentRef?: AgentRef | null;
  sessionId: string;
}): Promise<{ agentRefId: string; version: string; agent: string; adapter: 'agentview' | 'ai-sdk' }> {
  const parsed = parseVersion(opts.agentRef.version);
  if (!parsed) {
    throw new AgentViewError("Invalid version number format. Should be like '1.2.3' or '1.2.3-beta'", 422);
  }

  const version = versionToString(parsed);
  const agent = opts.agentRef.agent;
  const adapter = opts.agentRef.adapter ?? 'agentview';

  if (opts.previousAgentRef) {

    if (opts.previousAgentRef.adapter !== adapter) {
      throw new AgentViewError("Cannot continue a session with a different adapter.", 422);
    }

    if (opts.previousAgentRef.agent !== agent) {
      throw new AgentViewError("Cannot continue a session with a different agent.", 422);
    }

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
    organizationId: tx.organizationId,
    version,
    agent,
    adapter,
  }).onConflictDoNothing();

  const [agentRefRow] = await tx.select().from(agentRefs).where(and(eq(agentRefs.version, version), eq(agentRefs.agent, agent), eq(agentRefs.adapter, adapter))).limit(1);

  // Update session's agentRefs array if new
  const currentSession = await tx.query.sessions.findFirst({
    where: eq(sessions.id, opts.sessionId),
    columns: { agentRefs: true },
  });
  const existing = (currentSession?.agentRefs as { agent: string; version: string; adapter: "agentview" | "ai-sdk" }[]) ?? [];

  const alreadyExists = existing.some(ref => ref.agent === opts.agentRef.agent && ref.version === version);
  if (!alreadyExists) {
    await tx.update(sessions).set({
      agentRefs: [...existing, { agent, version, adapter }],
      updatedAt: new Date().toISOString(),
    }).where(eq(sessions.id, opts.sessionId));
  }

  return { agentRefId: agentRefRow.id, version, agent: opts.agentRef.agent, adapter };
}
