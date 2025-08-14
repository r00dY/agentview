import { type Thread } from "../apiTypes"
import z from "zod"

export function getLastRun(thread: Thread) {
  return thread.runs.length > 0 ? thread.runs[thread.runs.length - 1] : undefined
}

export function getActiveRuns(thread: Thread) {
  return thread.runs.filter((run, index) => run.state !== 'failed' || index === thread.runs.length - 1)
}

export function getAllActivities(thread: Thread, options?: { activeOnly?: boolean }) {
  const activities: any[] = []

  const activeRuns = options?.activeOnly ? getActiveRuns(thread) : thread.runs

  activeRuns.map((run, index) => {
    activities.push(...run.activities)
  })

  return activities
}

export function getVersions(thread: Thread) {
  const seen = new Set<string>();
  return thread.runs
    .map((run) => run.version)
    .filter((version) => {
      if (!version || seen.has(version.id)) return false;
      seen.add(version.id);
      return true;
    });
}