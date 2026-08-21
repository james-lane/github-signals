export function workflowWebUrl(hostname, group) {
    const run = group.latest || group.runs?.[0];
    const workflowFile = run?.workflowPath?.split('@')[0].split('/').at(-1);
    if (workflowFile)
        return `https://${hostname}/${group.repository}/actions/workflows/${encodeURIComponent(workflowFile)}`;
    if (run?.workflowId)
        return `https://${hostname}/${group.repository}/actions/workflows/${encodeURIComponent(String(run.workflowId))}`;
    return run?.url || `https://${hostname}/${group.repository}/actions`;
}
export function ciContextWebUrl(hostname, group, run, job) {
    return job?.url || run?.url || workflowWebUrl(hostname, group);
}
//# sourceMappingURL=web-navigation.js.map