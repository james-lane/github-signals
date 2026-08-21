export function workflowWebUrl(hostname: string, group: { repository: string; latest?: { workflowId?: string | number; url?: string }; runs?: Array<{ workflowId?: string | number; url?: string }> }) {
  const run = group.latest || group.runs?.[0];
  if (run?.workflowId) return `https://${hostname}/${group.repository}/actions/workflows/${encodeURIComponent(String(run.workflowId))}`;
  return run?.url || `https://${hostname}/${group.repository}/actions`;
}

export function ciContextWebUrl(hostname: string, group: Parameters<typeof workflowWebUrl>[1], run?: { url?: string }, job?: { url?: string }) {
  return job?.url || run?.url || workflowWebUrl(hostname, group);
}
