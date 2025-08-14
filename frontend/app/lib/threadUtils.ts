import { ThreadSchema } from "../apiTypes"
import z from "zod"

export function getLastRun(thread: z.infer<typeof ThreadSchema>) {
  return thread.runs.length > 0 ? thread.runs[thread.runs.length - 1] : undefined
}

export function getAllActivities(thread: z.infer<typeof ThreadSchema>) {
  const activities: any[] = []

  for (const run of thread.runs) {
    activities.push(...run.activities)
  }

  return activities
}