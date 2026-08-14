export declare const CONFIG_FILE = ".github-signals.json";
export declare const CACHE_FILE = ".github-signals-cache.json";
export declare const defaults: {
    hostname: string;
    lookbackDays: number;
    theme: string;
    showContributingRepositories: boolean;
    ciEnabled: boolean;
    historyRetentionDays: number;
    engineers: never[];
    repositories: never[];
    thresholds: {
        stalePrDays: number;
        staleIssueDays: number;
        reviewWaitHours: number;
        workflowFailureCount: number;
    };
};
export declare const THEMES: string[];
export declare function normalizeRepository(repository: any): {
    name: string;
    priority: string;
};
export declare const repositoryName: (repository: any) => string;
export declare const visibleRepositories: (config: any) => any;
export declare function normalizeEngineer(engineer: any): {
    id: string;
    name: string;
};
export declare const engineerId: (engineer: any) => string;
export declare function configPath(cwd?: string): string;
export declare function validateConfig(parsed?: {}): {
    hostname: string;
    lookbackDays: any;
    historyRetentionDays: any;
    showContributingRepositories: boolean;
    ciEnabled: boolean;
    theme: any;
    engineers: any;
    repositories: any;
    thresholds: {
        stalePrDays: any;
        staleIssueDays: any;
        reviewWaitHours: any;
        workflowFailureCount: any;
    };
};
export declare function loadConfig(cwd?: string): Promise<{
    hostname: string;
    lookbackDays: any;
    historyRetentionDays: any;
    showContributingRepositories: boolean;
    ciEnabled: boolean;
    theme: any;
    engineers: any;
    repositories: any;
    thresholds: {
        stalePrDays: any;
        staleIssueDays: any;
        reviewWaitHours: any;
        workflowFailureCount: any;
    };
}>;
export declare function saveConfig(config: any, cwd?: string): Promise<void>;
export declare function loadCache(cwd?: string): Promise<any>;
export declare function saveCache(data: any, cwd?: string): Promise<void>;
//# sourceMappingURL=config.d.ts.map