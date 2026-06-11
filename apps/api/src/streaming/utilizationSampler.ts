import { performance, type EventLoopUtilization } from 'node:perf_hooks';

export interface UtilizationSample {
    /** ms epoch at the end of the sampling window */
    t: number;
    /** event loop utilization over the window (0..1) */
    elu: number;
    /** process CPU (user+system) over the window, fraction of one core (can exceed 1) */
    cpu: number;
    /** live connections at sample time */
    conns: number;
    rss: number;
    heapUsed: number;
}

export interface UtilizationSampler {
    /** Samples newer than `since` (ms epoch). Omit to get the whole buffer. */
    getSamples(since?: number): UtilizationSample[];
    stop(): void;
}

/**
 * Continuously samples process utilization into a ring buffer so external
 * observers (e.g. stress tests) can poll a window of history instead of
 * single point-in-time snapshots.
 *
 * Unlike ELU alone, `cpu` is derived from `process.cpuUsage()` deltas, which
 * are monotonic — even if the event loop is so saturated that ticks fire
 * late, the average over the late window stays correct.
 */
export function startUtilizationSampler(opts: {
    getConnections: () => number;
    intervalMs?: number;
    maxSamples?: number;
}): UtilizationSampler {
    const intervalMs = opts.intervalMs ?? 1000;
    const maxSamples = opts.maxSamples ?? 900; // ~15 min at 1s

    let prevElu: EventLoopUtilization = performance.eventLoopUtilization();
    let prevCpu = process.cpuUsage();
    let prevTime = performance.now();

    const samples: UtilizationSample[] = [];

    function tick() {
        const nowElu = performance.eventLoopUtilization();
        const eluWindow = performance.eventLoopUtilization(nowElu, prevElu);
        prevElu = nowElu;

        const cpuDelta = process.cpuUsage(prevCpu);
        prevCpu = process.cpuUsage();

        const now = performance.now();
        const elapsedMs = now - prevTime;
        prevTime = now;

        const mem = process.memoryUsage();

        samples.push({
            t: Date.now(),
            elu: eluWindow.utilization,
            cpu: elapsedMs > 0 ? (cpuDelta.user + cpuDelta.system) / 1000 / elapsedMs : 0,
            conns: opts.getConnections(),
            rss: mem.rss,
            heapUsed: mem.heapUsed,
        });

        if (samples.length > maxSamples) {
            samples.splice(0, samples.length - maxSamples);
        }
    }

    const interval = setInterval(tick, intervalMs);
    interval.unref();

    return {
        getSamples(since?: number) {
            if (since == null) return samples.slice();
            // samples are appended in time order — find the first one past `since`
            let lo = 0;
            while (lo < samples.length && samples[lo].t <= since) lo++;
            return samples.slice(lo);
        },
        stop() {
            clearInterval(interval);
        },
    };
}
