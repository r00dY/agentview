import { type StandardRun, type StandardSession } from "./apiTypes.js"

export function getLastRun<SessionT extends StandardSession>(session: SessionT): SessionT["runs"][number] | undefined {
  return session.runs.length > 0 ? session.runs[session.runs.length - 1] : undefined
}

export function getActiveRuns<SessionT extends StandardSession>(session: SessionT): SessionT["runs"][number][] {
  return session.runs.filter((run, index) => run.status !== 'failed' || index === session.runs.length - 1)
}

export function getAllSessionItems<SessionT extends StandardSession>(session: SessionT, options?: { activeOnly?: boolean }): SessionT["runs"][number]["sessionItems"][number][] {
  const items: SessionT["runs"][number]["sessionItems"][number][] = []
  const activeRuns = options?.activeOnly ? getActiveRuns(session) : session.runs
  activeRuns.map((run) => {
    items.push(...run.sessionItems)
  })
  return items
}

function enhanceRun(run: StandardRun) {
  return {
    ...run,
    items: run.sessionItems.map((sessionItem) => sessionItem.content),
  };
}

export function enhanceSession(session: StandardSession) {
  const lastRun = getLastRun(session);

  return {
    ...session,
    runs: session.runs.map(enhanceRun),
    lastRun: lastRun ? enhanceRun(lastRun) : undefined,
    items: getAllSessionItems(session).map((item) => item.content)
  }
}
