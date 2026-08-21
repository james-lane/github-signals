export declare function workflowWebUrl(hostname: string, group: {
    repository: string;
    latest?: {
        workflowId?: string | number;
        url?: string;
    };
    runs?: Array<{
        workflowId?: string | number;
        url?: string;
    }>;
}): string;
export declare function ciContextWebUrl(hostname: string, group: Parameters<typeof workflowWebUrl>[1], run?: {
    url?: string;
}, job?: {
    url?: string;
}): string;
//# sourceMappingURL=web-navigation.d.ts.map