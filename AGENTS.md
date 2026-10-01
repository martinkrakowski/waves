# AGENTS.md

## What this project is

waves is a small multi-project status service. Projects push a versioned
`waves/v1` snapshot of each delegated wave they orchestrate, and one small
service renders them all into a single status view. The repository is a
standalone MIT monorepo holding two packages: `@waves/server` and
`@hexagen-monaco/waves-client`.

## Layer rule (hexagonal)

Every package is split into three layers under `src/`:

- `domain/` — pure business rules. No I/O, no clock, no randomness.
- `application/` — use cases that orchestrate the domain through ports.
- `infrastructure/` — adapters: HTTP, filesystem, timers, any `node:*` import.

`domain/` and `application/` import **nothing** from `node:*`, from any npm or
scoped package, and nothing from `infrastructure/`. Every such dependency
belongs in an adapter under `src/infrastructure/`. `eslint.config.js` enforces
this with `no-restricted-imports`; a violation is a lint error, not a style note.

## After any edit

```sh
yarn lint && yarn typecheck && yarn test:cov
```

All three must exit 0. `test:cov` enforces 100% lines, branches, functions and
statements, so an uncovered branch fails the gate. `yarn format` then
`yarn format:check` keeps Prettier's output.

## Rules

- Never `console.log` (or any `console.*`) outside a CLI shim such as
  `packages/*/src/cli.ts`; elsewhere `no-console` is an error. Inject I/O
  instead, as `main(argv, io)` does.
- Never commit a token, key, password or certificate, and never put one in an
  example, fixture or test.
- Never disable TLS verification. No `rejectUnauthorized: false`, no
  `NODE_TLS_REJECT_UNAUTHORIZED=0`, no custom `checkServerIdentity` that
  returns true.
- Use Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`,
  `test:`, `build:`, `ci:` — with a short imperative subject.
- Do not add AI attribution trailers or "generated with" footers to commits.
- Do not add a dependency that is not already declared, and do not add a
  framework to reach for a feature a few lines of code could provide.
