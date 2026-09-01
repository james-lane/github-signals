interface WebTarget {
  workflowId?: string | number;
  workflowPath?: string | null;
  url?: string | null;
}

interface WorkflowWebContext {
  repository: string;
  latest?: WebTarget;
  runs?: WebTarget[];
}

export function workflowWebUrl(hostname: string, group: WorkflowWebContext): string {
  const run = group.latest || group.runs?.[0];
  const workflowFile = run?.workflowPath?.split('@')[0].split('/').at(-1);
  if (workflowFile) return `https://${hostname}/${group.repository}/actions/workflows/${encodeURIComponent(workflowFile)}`;
  if (run?.workflowId) return `https://${hostname}/${group.repository}/actions/workflows/${encodeURIComponent(String(run.workflowId))}`;
  return run?.url || `https://${hostname}/${group.repository}/actions`;
}

export function ciContextWebUrl(hostname: string, group: WorkflowWebContext, run?: { url?: string | null }, job?: { url?: string | null }): string {
  return job?.url || run?.url || workflowWebUrl(hostname, group);
}
