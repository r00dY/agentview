import { performance, type EventLoopUtilization } from 'node:perf_hooks';

export interface PerfSnapshot {
    elu: {
        /** Utilization over the last completed sampling window (0..1). */
        window: number;
        /** Utilization since the last sampling tick (sub-window, computed on read). */
        instant: number;
    };
    memory: {
        rss: number;
        heapUsed: number;
        heapTotal: number;
        external: number;
    };
}

export interface PerfMonitor {
    /** Returns the latest snapshot. `elu.window` is from the last completed tick; `elu.instant` is computed on read. */
    get(): PerfSnapshot;
    /** Enable a one-line log every time a new window is sampled. */
    startPrinting(name: string): void;
    stopPrinting(): void;
    /** Stop the sampling interval. */
    stop(): void;
}

/**
 * Starts a lightweight performance monitor that samples event-loop utilization
 * and memory every `intervalMs` (default 1s). The interval is unref'd so it
 * does not keep the process alive.
 */
export function startMeasuring(intervalMs = 1000): PerfMonitor {
    let prev: EventLoopUtilization = performance.eventLoopUtilization();
    let lastWindow: EventLoopUtilization = { idle: 0, active: 0, utilization: 0 };
    let printName: string | null = null;

    function snapshot(instant: number): PerfSnapshot {
        const mem = process.memoryUsage();
        return {
            elu: { window: lastWindow.utilization, instant },
            memory: {
                rss: mem.rss,
                heapUsed: mem.heapUsed,
                heapTotal: mem.heapTotal,
                external: mem.external,
            },
        };
    }

    function tick() {
        const now = performance.eventLoopUtilization();
        lastWindow = performance.eventLoopUtilization(now, prev);
        prev = now;

        if (printName !== null) {
            const s = snapshot(lastWindow.utilization);
            const mb = (n: number) => (n / 1024 / 1024).toFixed(0);
            // console.log(
            //     `[${printName}] ELU ${(s.elu.window * 100).toFixed(1)}% | rss ${mb(s.memory.rss)}MB heap ${mb(s.memory.heapUsed)}/${mb(s.memory.heapTotal)}MB ext ${mb(s.memory.external)}MB`
            // );
            console.log(
                `[${printName}] ELU ${(s.elu.window * 100).toFixed(1)}%`
            );
        }
    }

    const interval = setInterval(tick, intervalMs);
    interval.unref();

    return {
        get() {
            const now = performance.eventLoopUtilization();
            const instant = performance.eventLoopUtilization(now, prev).utilization;
            return snapshot(instant);
        },
        startPrinting(name: string) {
            printName = name;
        },
        stopPrinting() {
            printName = null;
        },
        stop() {
            clearInterval(interval);
        },
    };
}
