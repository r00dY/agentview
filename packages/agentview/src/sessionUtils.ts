import { type Run, type Session } from "./apiTypes.js"

export function getLastRun<SessionT extends Session>(session: SessionT): SessionT["runs"][number] | undefined {
  return session.runs.length > 0 ? session.runs[session.runs.length - 1] : undefined
}

export function getActiveRuns<SessionT extends Session>(session: SessionT): SessionT["runs"][number][] {
  return session.runs.filter((run, index) => run.status !== 'failed' || index === session.runs.length - 1)
}

export function getAllSessionItems<SessionT extends Session>(session: SessionT, options?: { activeOnly?: boolean }): SessionT["runs"][number]["sessionItems"][number][] {
  const items: SessionT["runs"][number]["sessionItems"][number][] = []
  const activeRuns = options?.activeOnly ? getActiveRuns(session) : session.runs
  activeRuns.map((run, index) => {
    items.push(...run.sessionItems)
  })
  return items
}

export function getVersions(session: Session) {
  const versions: string[] = [];
  for (const run of session.runs) {
    if (run.agentRef?.version && !versions.includes(run.agentRef.version)) {
      versions.push(run.agentRef.version);
    }
  }
  return versions;
}

function enhanceRun(run: Run) {
  return {
    ...run,
    items: run.sessionItems.map((sessionItem) => sessionItem.content),
  };
}

export function enhanceSession(session: Session) {
  const lastRun = getLastRun(session);

  return {
    ...session,
    runs: session.runs.map(enhanceRun),
    lastRun: lastRun ? enhanceRun(lastRun) : undefined,
    items: getAllSessionItems(session).map((item) => item.content)
  }
}
