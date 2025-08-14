import { ThreadSchema } from "../apiTypes"
import z from "zod"

export function getLastRun(thread: z.infer<typeof ThreadSchema>) {
  return thread.runs.length > 0 ? thread.runs[thread.runs.length - 1] : undefined
}

export function getActiveRuns(thread: z.infer<typeof ThreadSchema>) {
  return thread.runs.filter((run, index) => run.state !== 'failed' || index === thread.runs.length - 1)
}

export function getAllActivities(thread: z.infer<typeof ThreadSchema>, options?: { activeOnly?: boolean }) {
  const activities: any[] = []

  const activeRuns = options?.activeOnly ? getActiveRuns(thread) : thread.runs

  activeRuns.map((run, index) => {
    activities.push(...run.activities)
  })

  return activities
}

// export function getVersions(thread: z.infer<typeof ThreadSchema>) {
//   return thread.runs.map((run) => run.version)
// }