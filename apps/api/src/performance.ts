import { performance } from 'node:perf_hooks';

export function printELU(name: string) {
    let prev = performance.eventLoopUtilization();

    setInterval(() => {
        const now = performance.eventLoopUtilization();
        const { utilization } = performance.eventLoopUtilization(now, prev);
        prev = now;
        console.log(`[${name}][ELU] ${(utilization * 100).toFixed(1)}%`);
    }, 1000);
}