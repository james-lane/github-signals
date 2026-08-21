export function workflowWebUrl(hostname, group) {
    const run = group.latest || group.runs?.[0];
    if (run?.workflowId)
        return `https://${hostname}/${group.repository}/actions/workflows/${encodeURIComponent(String(run.workflowId))}`;
    return run?.url || `https://${hostname}/${group.repository}/actions`;
}
export function ciContextWebUrl(hostname, group, run, job) {
    return job?.url || run?.url || workflowWebUrl(hostname, group);
}
//# sourceMappingURL=web-navigation.js.map