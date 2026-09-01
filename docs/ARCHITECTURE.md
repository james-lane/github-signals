# Architecture

GitHub Signals is organized by responsibility so a human or code-aware agent can locate a behavior from its name without scanning unrelated code.

## System map

```text
src/
├─ cli.ts                                  startup composition
├─ application/                            lifecycle, state, and user actions
├─ domain/                                 models, configuration, focus, calculations
├─ infrastructure/
│  ├─ config/                              configuration and cache file persistence
│  ├─ github/                              GitHub CLI, REST, GraphQL, and browser I/O
│  ├─ runtime/                             application metadata discovery
│  ├─ storage/                             SQLite persistence by record type
│  └─ system/                              operating-system integrations
├─ presentation/                           terminal renderer and product screens
└─ shared/                                 dependency-free errors, constants, statistics
```

`src/cli.ts` is the only source file at the root. It composes infrastructure dependencies and passes initial data into `GitHubSignalsApp`, which owns mutable application state and delegates keyboard, configuration, refresh, navigation, and settings behavior to focused action classes. There are no compatibility barrels or catch-all utility modules, so CodeGraph paths lead directly to the owning implementation.

## Where behavior lives

| Change | Primary location |
| --- | --- |
| Add or change a data shape | `src/domain/models.ts` |
| Calculate CI, workflow, repository, or paging values | `src/domain/dashboard-selectors.ts` |
| Change keyboard routing or focus behavior | `src/application/keyboard-router.ts` |
| Change a configuration, refresh, navigation, or settings action | matching `*-actions.ts` file in `src/application/` |
| Change lifecycle, prompts, polling, or shared state | `src/application/github-signals-app.ts` |
| Change a screen | `src/presentation/screens/*-screen.ts` |
| Change terminal styling or formatting | `src/presentation/terminal/` |
| Change terminal-input sanitization | `src/presentation/terminal/sanitize.ts` |
| Change system-focus weighting | `src/domain/focus.ts` |
| Change configuration validation or selection | `src/domain/configuration.ts` |
| Change configuration or cache files | `src/infrastructure/config/config-store.ts` |
| Change CI web URL selection | `src/infrastructure/github/web-urls.ts` |
| Change GitHub Status polling or parsing | `src/infrastructure/github/status.ts` |
| Change GitHub authentication or web navigation | `src/infrastructure/github/browser.ts` |
| Change REST or GraphQL process execution | `src/infrastructure/github/gh-client.ts` |
| Change Actions, commit, PR, or signal collection | matching file in `src/infrastructure/github/` |
| Change clipboard integration | `src/infrastructure/system/clipboard.ts` |
| Change package-version discovery | `src/infrastructure/runtime/version.ts` |
| Change SQLite schema | `src/infrastructure/storage/history-database.ts` |
| Change one stored record type | matching store in `src/infrastructure/storage/` |
| Change CI or release automation | `.github/workflows/` |
| Change release-package contents | `package.json` `files` list |

## Runtime flows

### Startup

`main` loads the package version, validated configuration, cached signals, authentication, and local history from their concrete infrastructure modules, then constructs `GitHubSignalsApp`. The app owns lifecycle and shared state, while focused action classes own keyboard, navigation, refresh, configuration, and settings behavior. `DashboardRenderer` selects exactly one screen renderer for the active view.

### Refresh

`RefreshActions.refresh` invokes `fetchSignals`. The signal collector coordinates focused GitHub adapters and reports progress. A complete result is saved to the cache and specialized SQLite stores; partial or cancelled results do not create a snapshot.

### Rendering

The controller normalizes selection indexes before rendering. Screen functions read state and write through `TerminalCanvas`; they do not fetch data or mutate application state. Shared formatting and theme behavior is centralized under `presentation/terminal`.

## Boundary rules

- User JSON is normalized by `validateConfig` before it becomes `AppConfig`.
- GitHub REST and GraphQL payload types stay inside their adapter. Each adapter returns domain models.
- SQLite snake_case rows stay inside storage modules. Stores return domain models or explicitly named history-row models.
- Errors cross boundaries as `unknown` and are converted to a message once with `errorMessage`.
- Domain configuration, focus, and dashboard selectors are deterministic and side-effect free. They may depend only on other domain modules or dependency-free shared modules.
- Presentation screens consume application state and render through `TerminalCanvas`; external requests, persistence, and process spawning remain outside screen modules.
- Infrastructure modules normalize external payloads and own filesystem, SQLite, process, network, and operating-system interactions.
- The architecture test enforces `src/cli.ts` as the only root source file and prevents domain modules from importing outer layers or Node.js runtime APIs.

These rules apply the [Clean Code TypeScript](https://github.com/labs42io/clean-code-typescript) emphasis on meaningful names, small functions, single-purpose modules, explicit types, and isolated side effects without treating any guideline as a substitute for project-specific boundaries.

## Build and distribution

TypeScript source and tests are canonical. `npm run build` removes the previous `dist/` tree before compiling, which prevents renamed modules from leaving stale release files. `npm run check` performs that clean build before running the compiled tests. Generated JavaScript, declarations, and source maps are ignored by Git.

CI builds from a clean checkout. Tags matching `v<package version>` additionally run the same checks and create a GitHub Release containing the `.tgz` selected by the `package.json` `files` list. This keeps generated code out of reviews and CodeGraph while preserving a dependency-free compiled download for users.

## CodeGraph

The local `.codegraph/` database is ignored by Git. After indexing with `codegraph init`, use semantic questions rather than broad file scans. Generated `dist/` output is also ignored, so indexed call paths remain centered on the canonical TypeScript. Useful starting queries include:

```sh
codegraph explore "refresh signals and persist a snapshot"
codegraph explore "render the repository pull request detail"
codegraph explore "validate and save configuration"
codegraph explore "calculate CI workflow metrics"
```

The feature-based symbol names are intentionally mirrored across the controller, domain selectors, adapters, stores, and tests so call paths remain obvious in the graph.
