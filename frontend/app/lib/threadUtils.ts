export function getLastRun(thread: any) {
  return thread.runs.length > 0 ? thread.runs[thread.runs.length - 1] : undefined
}

export function getAllActivities(thread: any) {
  const activities: any[] = []

  for (const run of thread.runs) {
    activities.push(...run.activities)
  }

  return activities
}