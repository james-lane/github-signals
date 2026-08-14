export declare const HISTORY_FILE = ".github-signals-history.sqlite";
export declare function scopeFingerprint(config: any): string;
export declare function recordSnapshot(config: any, data: any, cwd?: string): Promise<boolean>;
export declare function loadHistory(config: any, limit?: number, cwd?: string): Record<string, import("node:sqlite").SQLOutputValue>[];
export declare function loadEngineerFocusHistory(config: any, limit?: number, cwd?: string): {
    [x: string]: import("node:sqlite").SQLOutputValue;
}[];
export declare function recordCiRuns(config: any, runs: any, cwd?: string): Promise<number>;
export declare function loadCiRuns(config: any, limitPerRepository?: number, cwd?: string): {
    repository: import("node:sqlite").SQLOutputValue;
    id: import("node:sqlite").SQLOutputValue;
    attempt: import("node:sqlite").SQLOutputValue;
    workflowId: import("node:sqlite").SQLOutputValue;
    workflow: import("node:sqlite").SQLOutputValue;
    title: import("node:sqlite").SQLOutputValue;
    event: import("node:sqlite").SQLOutputValue;
    status: import("node:sqlite").SQLOutputValue;
    conclusion: import("node:sqlite").SQLOutputValue;
    createdAt: import("node:sqlite").SQLOutputValue;
    startedAt: import("node:sqlite").SQLOutputValue;
    updatedAt: import("node:sqlite").SQLOutputValue;
    durationMs: import("node:sqlite").SQLOutputValue;
    queueMs: import("node:sqlite").SQLOutputValue;
    headSha: import("node:sqlite").SQLOutputValue;
    headBranch: import("node:sqlite").SQLOutputValue;
    actor: import("node:sqlite").SQLOutputValue;
    url: import("node:sqlite").SQLOutputValue;
    pullRequests: any;
}[];
//# sourceMappingURL=history.d.ts.map