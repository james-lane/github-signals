export declare const HISTORY_FILE = ".github-signals-history.sqlite";
export declare function scopeFingerprint(config: any): string;
export declare function recordSnapshot(config: any, data: any, cwd?: string): Promise<boolean>;
export declare function loadHistory(config: any, limit?: number, cwd?: string): Record<string, import("node:sqlite").SQLOutputValue>[];
//# sourceMappingURL=history.d.ts.map