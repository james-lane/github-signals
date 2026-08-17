// @ts-nocheck -- GitHub activity payloads are normalized at the API boundary.
export const focusScore = item => (item.commits || 0) + (item.pullRequests || 0) * 3 + (item.merged || 0) * 2 + (item.reviews || 0) * 2;
export const aggregateEngineerFocus = signals => {
    const repositories = new Map();
    for (const signal of signals.filter(item => item && !item.error)) {
        for (const repository of signal.repositories || []) {
            if (!repositories.has(repository.name))
                repositories.set(repository.name, {
                    name: repository.name, commits: 0, pullRequests: 0, merged: 0, reviews: 0, activeDays: 0,
                });
            const aggregate = repositories.get(repository.name);
            aggregate.commits += repository.commits || 0;
            aggregate.pullRequests += repository.pullRequests || 0;
            aggregate.merged += repository.merged || 0;
            aggregate.reviews += repository.reviews || 0;
            aggregate.activeDays += repository.activeDays || 0;
        }
    }
    return { login: null, repositories: [...repositories.values()] };
};
//# sourceMappingURL=focus.js.map