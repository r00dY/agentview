import { performance, type EventLoopUtilization } from 'node:perf_hooks';

let prev: EventLoopUtilization = performance.eventLoopUtilization();
let lastWindow: EventLoopUtilization = { idle: 0, active: 0, utilization: 0 };
let started = false;

function sampleTick(name: string) {
    const now = performance.eventLoopUtilization();
    lastWindow = performance.eventLoopUtilization(now, prev);
    prev = now;
    console.log(`[${name}][ELU] ${(lastWindow.utilization * 100).toFixed(1)}%`);
}

export function printELU(name: string) {
    if (started) return;
    started = true;

    prev = performance.eventLoopUtilization();
    setInterval(() => sampleTick(name), 1000).unref();
}

/**
 * Returns event-loop utilization metrics.
 * - `window`: utilization over the last completed 1s sampling window
 * - `instant`: utilization since the last sampling tick (sub-second, computed on read)
 */
export function getELU(): { window: number; instant: number } {
    const now = performance.eventLoopUtilization();
    const instant = performance.eventLoopUtilization(now, prev).utilization;
    return {
        window: lastWindow.utilization,
        instant,
    };
}
