import { performance, type EventLoopUtilization } from 'node:perf_hooks';

export interface CpuSample {
    /** ms epoch at the end of the sampling window */
    t: number;
    /** event loop utilization over the window (0..1) */
    elu: number;
    /** process CPU (user+system) over the window, fraction of one core (can exceed 1) */
    cpu: number;
}

export interface CpuSummary {
    samples: number;
    elu: { avg: number; p95: number; max: number };
    cpu: { avg: number; p95: number; max: number };
}

export interface CpuTracker {
    getSamples(): CpuSample[];
    summary(): CpuSummary | null;
    stop(): void;
}

export function summarize(samples: { elu: number; cpu: number }[]): CpuSummary | null {
    if (samples.length === 0) return null;
    const stat = (values: number[]) => {
        const sorted = values.slice().sort((a, b) => a - b);
        return {
            avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
            p95: sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)],
            max: sorted[sorted.length - 1],
        };
    };
    return {
        samples: samples.length,
        elu: stat(samples.map((s) => s.elu)),
        cpu: stat(samples.map((s) => s.cpu)),
    };
}

export function formatCpuSummary(label: string, summary: CpuSummary | null): string {
    if (!summary) return `  ${label}: no samples`;
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
    return [
        `  ${label} (${summary.samples} samples):`,
        `    ELU  avg=${pct(summary.elu.avg)} p95=${pct(summary.elu.p95)} max=${pct(summary.elu.max)}`,
        `    CPU  avg=${pct(summary.cpu.avg)} p95=${pct(summary.cpu.p95)} max=${pct(summary.cpu.max)}`,
    ].join('\n');
}

/**
 * Samples this process's event loop utilization and CPU usage every second.
 *
 * `cpu` comes from `process.cpuUsage()` deltas, which are monotonic — if the
 * event loop is saturated and the tick fires late, the average over the late
 * window is still correct, so a strained process can't hide its own strain.
 */
export function startCpuTracker(intervalMs = 1000): CpuTracker {
    let prevElu: EventLoopUtilization = performance.eventLoopUtilization();
    let prevCpu = process.cpuUsage();
    let prevTime = performance.now();

    const samples: CpuSample[] = [];

    const interval = setInterval(() => {
        const nowElu = performance.eventLoopUtilization();
        const eluWindow = performance.eventLoopUtilization(nowElu, prevElu);
        prevElu = nowElu;

        const cpuDelta = process.cpuUsage(prevCpu);
        prevCpu = process.cpuUsage();

        const now = performance.now();
        const elapsedMs = now - prevTime;
        prevTime = now;

        samples.push({
            t: Date.now(),
            elu: eluWindow.utilization,
            cpu: elapsedMs > 0 ? (cpuDelta.user + cpuDelta.system) / 1000 / elapsedMs : 0,
        });
    }, intervalMs);
    interval.unref();

    return {
        getSamples: () => samples.slice(),
        summary: () => summarize(samples),
        stop: () => clearInterval(interval),
    };
}
