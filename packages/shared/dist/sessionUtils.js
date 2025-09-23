import {} from "./apiTypes";
export function getLastRun(session) {
    return session.runs.length > 0 ? session.runs[session.runs.length - 1] : undefined;
}
export function getActiveRuns(session) {
    return session.runs.filter((run, index) => run.state !== 'failed' || index === session.runs.length - 1);
}
export function getAllSessionItems(session, options) {
    const items = [];
    const activeRuns = options?.activeOnly ? getActiveRuns(session) : session.runs;
    activeRuns.map((run, index) => {
        items.push(...run.sessionItems);
    });
    return items;
}
export function getVersions(session) {
    const seen = new Set();
    return session.runs
        .map((run) => run.version)
        .filter((version) => {
        if (!version || seen.has(version.id))
            return false;
        seen.add(version.id);
        return true;
    });
}
//# sourceMappingURL=sessionUtils.js.map