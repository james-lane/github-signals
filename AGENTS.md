# GitHub Signals agent guide

## Start here

When `.codegraph/` exists, use `codegraph explore` before text search or broad file reads. Ask for the feature or symbol you intend to change; the graph returns the implementation and its call paths.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before making cross-layer changes.

## Dependency direction

Keep orchestration at the entry point and in the application layer. Domain calculations and shared utilities stay deterministic; presentation owns terminal rendering; infrastructure owns GitHub and persistence side effects:

```text
cli → application ─┬→ domain
                   ├→ presentation
                   └→ infrastructure → domain

domain, presentation, and infrastructure may use dependency-free shared modules
```

- `src/cli.ts` is the only source file allowed at the root. Put every implementation in its owning layer and feature directory.
- Domain code is pure and must not read files, start processes, call GitHub, or write to the terminal.
- Infrastructure code owns external payload normalization and local persistence.
- Presentation screen modules render one product area each and do not perform I/O beyond the supplied terminal canvas.
- `GitHubSignalsApp` owns mutable application state and lifecycle; focused `*-actions.ts` classes own user actions.
- Import the owning module directly. Do not add compatibility barrels, facade files, or generic utility collections.
- Keep configuration validation in `domain/configuration.ts` and configuration/cache file access in `infrastructure/config/config-store.ts`.

Follow [Clean Code TypeScript](https://github.com/labs42io/clean-code-typescript) where it reinforces these repository-specific rules: use intention-revealing names, focused functions and modules, explicit types, early validation, and tests at behavior boundaries.

## Change workflow

1. Locate the relevant symbol and callers with CodeGraph.
2. Change the smallest cohesive module.
3. Add a focused test for domain calculations, boundary normalization, or storage behavior.
4. Keep `src/cli.ts` as the only root source file.
5. Run `npm run check`.
6. Never commit `dist/`; clean builds, CI, and tagged releases generate it from source.

Do not introduce `any`, `@ts-ignore`, or `@ts-nocheck`. Treat GitHub responses and user-owned JSON as `unknown` until they cross a typed normalization boundary.

## Releases

Keep `package.json` and `package-lock.json` versions equal. A `v<version>` tag must match that package version; the release workflow verifies it, builds and tests from a clean checkout, and publishes the compiled `.tgz` asset. Change release contents through the `package.json` `files` list rather than committing generated output.
