export type Job = { name: string; path: string; due: (slot: { minute: number; hour: number; day: number }) => boolean };
export declare const JOBS: Job[];
export declare function dueJobs(at: Date): Job[];
