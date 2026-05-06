import { eq, and } from 'drizzle-orm';
import { agentRefs } from './schemas/schema';
import { AgentViewError } from 'agentview/AgentViewError';
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
  name: string;
  adapter?: 'agentview' | 'ai-sdk';
}

export type AgentRefWithId = AgentRef & { id: string };

/**
 * Validates version against previous, upserts the agent_refs row,
 * and updates the session's agentRefs array.
 */
export async function resolveAgentRef(tx: OrgTransaction, opts: {
  agentRef: InputAgentRef;
  previousAgentRef?: AgentRef | null;
}): Promise<{ id: string; version: string; agent: string; adapter: 'agentview' | 'ai-sdk' }> {

  // valiate version string
  const parsed = parseVersion(opts.agentRef.version);
  if (!parsed) {
    throw new AgentViewError("Invalid version number format. Should be like '1.2.3' or '1.2.3-beta'", 422);
  }

  const agent = opts.agentRef.name;
  const adapter = opts.agentRef.adapter ?? 'agentview';

  // validate against previous one (semver compat)
  if (opts.previousAgentRef) {
    if (opts.previousAgentRef.adapter !== adapter) {
      throw new AgentViewError("Cannot continue a session with a different adapter.", 422);
    }

    if (opts.previousAgentRef.name !== agent) {
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

  const version = versionToString(parsed);

  // insert to db
  await tx.insert(agentRefs).values({
    organizationId: tx.organizationId,
    version,
    agent,
    adapter,
  }).onConflictDoNothing();

  const [row] = await tx.select().from(agentRefs).where(and(eq(agentRefs.version, version), eq(agentRefs.agent, agent), eq(agentRefs.adapter, adapter))).limit(1);

  return { id: row.id, version, agent, adapter };
}
