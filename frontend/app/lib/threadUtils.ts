import { ThreadSchema } from "../apiTypes"
import z from "zod"

export function getLastRun(thread: z.infer<typeof ThreadSchema>) {
  return thread.runs.length > 0 ? thread.runs[thread.runs.length - 1] : undefined
}

export function getAllActivities(thread: z.infer<typeof ThreadSchema>, options?: { activeOnly?: boolean }) {
  const activities: any[] = []

  thread.runs.map((run, index) => {
    if (options?.activeOnly && run.state === 'failed' && index !== thread.runs.length - 1) {
      return
    }

    activities.push(...run.activities)
  })

  return activities
}
