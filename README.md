# GitHub Signals

A zero-install terminal dashboard for team activity and repository health. It uses the GitHub CLI for authentication and API access, so it inherits access to private and enterprise repositories from your existing `gh` login.

The header also checks GitHub's public Statuspage API once a minute and shows the current platform status at the top right. This check is enabled by default, asynchronous, has a five-second timeout, is not stored in history, and falls back to `unavailable` without interrupting the app. Toggle `GitHub status` in Settings or set `"githubStatusEnabled": false` to disable it.

The dashboard runs in the terminal's alternate screen and clears that screen's saved lines after redraws. This keeps dashboard history out of scrollback while restoring the shell's previous contents and scrollback when it exits.

## Run

Requirements: Node.js 22.5+ and [GitHub CLI](https://cli.github.com/). Node.js 22.5 or newer is required for the built-in SQLite snapshot store.

```sh
cp .github-signals.example.json .github-signals.json
npm start
```

No dependency install is needed to run the app: the compiled JavaScript in `dist/` is versioned with the repository and uses only Node.js built-ins at runtime.

Edit `.github-signals.json` with your GitHub usernames and `owner/repository` names, or manage them from inside the app. The live configuration and cache are ignored by Git because they may contain engineer identities, private repository names, and cached enterprise activity. Only the sanitized `.github-signals.example.json` should be committed.

On first launch, press `l` to run the normal `gh auth login` web flow. If you already use an enterprise host, open Settings and set its hostname first. GitHub Enterprise Server users may need to authenticate beforehand with `gh auth login --hostname github.example.com`.

## Controls

- `←` / `→` or `Tab`: switch screens from the main navigation
- `Enter`: enter Engineers, Repositories, or Settings
- `Enter` on Settings: enter settings; use `↑` / `↓` and `Enter` to edit a value
- `←` / `→` while editing Theme: cycle themes with a live preview
- `y` in Settings: copy the complete portable setup as JSON; cache and snapshot history are excluded
- `Esc`: return from a focused view to the main navigation
- `↑` / `↓` in a table: select an engineer or repository
- `←` / `→` in Repositories: select a metric column
- `↑` / `↓` in History: move through the snapshot list and inspect metrics at that point
- `Enter` in a table: open the selected profile, repository, or filtered metric page
- `Enter` on a repository's Open PRs metric: inspect its pull requests in the terminal; use `↑` / `↓`, `Enter` to open on the web, and `Esc` to return
- `Enter` in CI: drill from workflow metrics into recent runs, then into job and step timing; `Esc` moves back one level
- `a`: add an engineer or repository
- `d`: remove an item from the Engineers or Repositories screen
- `p`: toggle a repository between owned and contributing
- `v` in Repositories or its PR view: show or hide Renovate-authored pull requests
- `r`: refresh signals
- `s`: open the GitHub Status webpage
- `c`: cancel an in-progress refresh
- `l`: authenticate with `gh`
- `q`: quit

Configuration, the last successful result, and historical snapshots are stored as `.github-signals.json`, `.github-signals-cache.json`, and `.github-signals-history.sqlite`. These files are ignored by Git and created with owner-only permissions. Tokens are never read or stored by the app. A sanitized [.github-signals.example.json](.github-signals.example.json) documents the complete configuration shape.

GitHub Actions visibility is opt-in because it adds one bounded REST request per in-scope repository during refresh. Enable `CI visibility` in Settings or set `"ciEnabled": true`; it defaults to `false`.

Successful refreshes store aggregated engineer and repository metrics in SQLite. Cancelled or partially failed refreshes are not recorded, snapshots within 15 minutes are deduplicated, and data older than the configurable retention period (90 days by default) is pruned. History is matched to the active scope and thresholds before it is used for dashboard sparklines.

Once a matching snapshot exists, a History view appears before Settings. It charts rolling team activity and repository-attention metrics with Unicode sparklines and direction indicators. When CI visibility is enabled, it also charts GitHub Actions success rate, failures, p50/p95 duration, and median queue time for the configured lookback window as it stood at the selected snapshot.

The Settings editor offers `Default`, `TVA`, `Cyberpunk`, `Matrix`, `Dracula`, `Nord`, `Solarized Dark`, `Synthwave`, and `Blueprint` themes. Configure one in the app or set `theme` to its lowercase name; Solarized Dark uses `"solarized-dark"`.

Repositories can be prioritised by relationship. Owned repositories appear first and receive a separate attention total on the overview:

```json
"repositories": [
  { "name": "your-org/core-service", "priority": "owned" },
  { "name": "another-org/shared-library", "priority": "contributing" }
]
```

Legacy `"owner/repository"` string entries remain supported and are treated as `contributing`.

Only owned repositories are included in signals by default. Set `"showContributingRepositories": true` or enable the option from Settings to include contributing repositories in repository health and engineer activity scope.

Engineers support a GitHub login ID and a human-friendly display name:

```json
"engineers": [
  { "id": "octocat", "name": "Mona Lisa Octocat" }
]
```

Legacy username strings remain supported; their ID is also used as their display name.

## Signals

Engineer activity includes default-branch commits, opened and merged pull requests, and reviewed pull requests over a configurable lookback. These counts are read directly from the repositories, so private organization activity is included when the authenticated account can access it. Repository health includes open/stale pull requests, pull requests whose GitHub review decision remains required beyond the configured wait threshold, open/stale issues, and the latest default-branch CI status.

The Engineers screen shows the whole team's weighted system-focus distribution while the main navigation has focus. Enter the screen and select an engineer to switch the breakdown to that individual. Team `Eng days` is the sum of engineer-active days per repository, while focus remains weighted by commits, pull requests, merges, and reviews rather than elapsed hours.

The highlighted engineer also shows a system-focus breakdown by repository: focus share, active days, commits, pull requests, merges, reviews, owned-repository share, and primary-system concentration. Focus uses a transparent activity weighting of commit `1`, pull request `3`, merge `2`, and review `2`. It describes where visible work happened, not hours worked or individual performance. Successful snapshots retain this repository breakdown so the primary-system share can be shown as a trend after new focus-aware snapshots have accumulated.

Engineer and repository health are fetched together in small GraphQL batches. Refreshes run only when requested by the user, never poll in the background, and the overview shows the remaining GraphQL allowance and reset time.

Repository activity queries use deliberately small, sequential batches with a short pause between them. Review activity uses each pull request's latest unique reviews, avoiding high-cost nested review histories and GitHub GraphQL resource-limit failures.

The app enforces a 60-second cooldown between refresh attempts and never automatically retries a rate-limit response. If GitHub reports a secondary limit, wait for the requested period before refreshing again.

Refresh progress is shown as a determinate footer bar across repository, engineer-focus, and optional GitHub Actions collection. The current stage and percentage remain visible. Navigation continues to work during collection, `Esc` retains its normal back-navigation behaviour, and `c` cancels without replacing the previous successful signals.

GitHub GraphQL connections are bounded to keep queries within resource limits, so extremely high-volume repositories may exceed the fetched activity window. This dashboard is intended for useful team signals, not payroll or performance scoring.

## CI visibility

The CI view uses only GitHub Actions data available through the authenticated `gh` CLI. Each refresh captures the latest 20 workflow runs for every in-scope repository and stores them in the local SQLite history database. It calculates workflow run counts, success and failure rates, median and p95 duration, median queue time, and latest status. The Overview dashboard summarizes these measures alongside failing and currently running workflows, while History shows how they changed at each stored snapshot.

Select a workflow to inspect recent runs and their branch, result, duration, queue time, attempt, event, actor, and commit. Selecting a run fetches its jobs and step timings on demand, keeping normal refreshes bounded. Press Enter on a job to open it on GitHub. Pull-request details also summarize stored Actions runs matching the PR's head commit.

This feature does not attempt test-case analytics, distributed traces, coverage analysis, or flaky-test detection because GitHub does not expose those consistently without additional workflow instrumentation or uploaded reports.

## Development

The source and tests are written in TypeScript. Contributors install the pinned development dependencies and build before testing:

```sh
npm ci
npm run hooks:install
npm run check
```

`npm run build` compiles `src/` and `test/` into `dist/`. Commit the regenerated `dist/` output whenever TypeScript source changes so users can continue to run the checked-out application without installing packages. CI builds, tests, and verifies that the committed output is current.

The app version comes from `package.json` and is always displayed at the bottom-right of the terminal. The tracked pre-push hook prevents application changes from being pushed without a version change. When needed, it increments the patch version in `package.json` and `package-lock.json`, stops the push, and asks you to commit that bump before retrying. Install the hook once per clone with `npm run hooks:install`.

While the app is running, it sets a concise dynamic terminal title such as `GitHub Signals — Repositories`. Some terminals append profile-controlled details such as the working directory, active process, command line or dimensions. In macOS Terminal, open **Settings → Profiles → Window → Title** and disable those title components if you want only the app title.
