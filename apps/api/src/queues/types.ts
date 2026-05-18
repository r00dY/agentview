import type { QueueOptions, Job, WorkOptions } from 'pg-boss';

export type Queue<T = unknown> = {
    name: string;
    options?: QueueOptions;
    workOptions?: WorkOptions;
    handler: (job: Array<Job<T>>) => Promise<void>;
};