export declare function runGh(args: any, { input, allowFailure, signal }?: {
    allowFailure?: boolean | undefined;
}): Promise<unknown>;
export declare function authStatus(hostname: any): Promise<{
    loggedIn: boolean;
    detail: any;
}>;
export declare function login(hostname: any): Promise<unknown>;
export declare function openRepository(fullName: any, hostname: any): Promise<void>;
export declare function openEngineer(loginName: any, hostname: any): Promise<unknown>;
export declare function openRepositoryMetric(fullName: any, hostname: any, metric: any, thresholds: any): Promise<unknown>;
export declare function openPullRequest(url: any): Promise<unknown>;
export declare function fetchOpenPullRequests(fullName: any, hostname: any, signal: any): Promise<{
    totalCount: any;
    rateLimit: any;
    pullRequests: any;
}>;
export declare const isRenovateAuthor: (login: any) => boolean;
export declare function engineerSignalsFromRepositories(engineers: any, activity: any, since: any): unknown[];
export declare function fetchSignals(config: any, onProgress?: () => void, { signal }?: {}): Promise<{
    fetchedAt: string;
    since: string;
    engineers: any;
    repositories: any[];
    rateLimit: any;
}>;
//# sourceMappingURL=github.d.ts.map