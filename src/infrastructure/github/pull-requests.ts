import type { OpenPullRequests, PullRequestCommit, PullRequestDetails, RateLimit } from '../../domain/models.js';
import { githubGraphql } from './gh-client.js';

interface PullRequestGraphqlResponse {
  data?: {
    repository?: {
      pullRequests: {
        totalCount: number;
        nodes: PullRequestNode[];
      };
    } | null;
    rateLimit?: RateLimit;
  };
}

interface PullRequestNode {
  number: number;
  title: string;
  body?: string;
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  url: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  headRefOid: string;
  mergeable?: string;
  reviewDecision?: string;
  author?: { login?: string } | null;
  labels: { nodes: Array<{ name: string }> };
  assignees: { nodes: Array<{ login: string }> };
  reviewRequests: { nodes: Array<{ requestedReviewer?: { login?: string; name?: string } | null }> };
  comments: { totalCount: number };
  commits: { totalCount: number; nodes: Array<{ commit: PullRequestCommit }> };
  latestReviews: { nodes: PullRequestDetails['reviews'] };
}

export async function fetchOpenPullRequests(
  fullName: string,
  hostname: string,
  signal?: AbortSignal,
): Promise<OpenPullRequests> {
  const [owner = '', name = ''] = fullName.split('/');
  const query = `query {
    repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
      pullRequests(first: 50, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
        totalCount
        nodes {
          number title body createdAt updatedAt isDraft url additions deletions changedFiles headRefOid
          mergeable reviewDecision
          author { login }
          labels(first: 10) { nodes { name } }
          assignees(first: 10) { nodes { login } }
          reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
          comments { totalCount }
          commits(first: 50) {
            totalCount
            nodes { commit { oid committedDate messageHeadline authors(first: 10) { nodes { name user { login } } } } }
          }
          latestReviews(first: 20) { nodes { state submittedAt author { login } } }
        }
      }
    }
    rateLimit { cost remaining resetAt }
  }`;
  const result = await githubGraphql<PullRequestGraphqlResponse>(hostname, query, signal);
  const connection = result.data?.repository?.pullRequests;
  if (!connection) throw new Error('Repository not found or not accessible.');

  return {
    totalCount: connection.totalCount,
    rateLimit: result.data?.rateLimit ?? null,
    pullRequests: connection.nodes.map(normalizePullRequest),
  };
}

function normalizePullRequest(pullRequest: PullRequestNode): PullRequestDetails {
  return {
    ...pullRequest,
    commits: pullRequest.commits.nodes.map(node => node.commit),
    commitCount: pullRequest.commits.totalCount,
    reviews: pullRequest.latestReviews.nodes,
    labels: pullRequest.labels.nodes.map(label => label.name),
    assignees: pullRequest.assignees.nodes.map(user => user.login),
    requestedReviewers: pullRequest.reviewRequests.nodes
      .map(request => request.requestedReviewer?.login ?? request.requestedReviewer?.name)
      .filter((reviewer): reviewer is string => Boolean(reviewer)),
    commentCount: pullRequest.comments.totalCount,
  };
}
