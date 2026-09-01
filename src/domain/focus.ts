import type { EngineerRepositorySignal } from './models.js';

export type FocusActivity = Partial<EngineerRepositorySignal>;

interface EngineerFocusInput {
  login?: string;
  error?: string;
  repositories?: Array<Pick<EngineerRepositorySignal, 'name'> & Partial<EngineerRepositorySignal>>;
}

export function focusScore(activity: FocusActivity): number {
  return (activity.commits ?? 0)
    + (activity.pullRequests ?? 0) * 3
    + (activity.merged ?? 0) * 2
    + (activity.reviews ?? 0) * 2;
}

export function aggregateEngineerFocus(signals: readonly EngineerFocusInput[]): { repositories: EngineerRepositorySignal[] } {
  const repositoriesByName = new Map<string, EngineerRepositorySignal>();

  for (const signal of signals.filter(item => !item.error)) {
    for (const repository of signal.repositories ?? []) {
      const aggregate = repositoriesByName.get(repository.name) ?? emptyRepositorySignal(repository.name);
      aggregate.commits += repository.commits ?? 0;
      aggregate.pullRequests += repository.pullRequests ?? 0;
      aggregate.merged += repository.merged ?? 0;
      aggregate.reviews += repository.reviews ?? 0;
      aggregate.activeDays += repository.activeDays ?? 0;
      repositoriesByName.set(repository.name, aggregate);
    }
  }

  return { repositories: [...repositoriesByName.values()] };
}

function emptyRepositorySignal(name: string): EngineerRepositorySignal {
  return { name, commits: 0, pullRequests: 0, merged: 0, reviews: 0, activeDays: 0 };
}
