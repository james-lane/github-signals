export declare const GITHUB_STATUS_URL = "https://www.githubstatus.com/api/v2/status.json";
export declare function parseGitHubStatus(payload: unknown): {
    indicator: string;
    description: string;
    checkedAt: string;
};
export declare function fetchGitHubStatus(): Promise<{
    indicator: string;
    description: string;
    checkedAt: string;
}>;
//# sourceMappingURL=github-status.d.ts.map