# waves

One status page for every project's delegated waves. Projects push a versioned `waves/v1` snapshot of each wave they orchestrate; one small service renders them all.

Status: the write path has landed, the read path is live. The design and its decisions are recorded in the plan that started this project; the push contract lives in `docs/waves-v1.md`.

Projects write their own waves: `PUT` and `DELETE` on a wave of a project with that project's bearer token, `POST` on the project collection and `DELETE` on a project with the admin token. `docs/` carries the contract for both.

## Layout

- `packages/server` (`@waves/server`) — the service that ingests snapshots and renders the status view.
- `packages/client` (`@hexagen-monaco/waves-client`) — the published client package and the `waves` CLI.

Each package is layered: `src/domain/` holds pure business rules, `src/application/` orchestrates them through ports, and `src/infrastructure/` holds every adapter — HTTP, filesystem, timers, any `node:*` import. Domain and application code imports nothing outside the package's own layers; `eslint.config.js` enforces that.

## Develop

```sh
corepack enable
yarn install
yarn test:cov
```

Licensed under MIT.
