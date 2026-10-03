# Plan: the next three waves

Owner-approved direction, 2026-10-02. This is the first planning document that
lives in waves itself; the decisions that created the service (D190–D200) are in
campaign-foundry's `docs/planning/2026-10-01_waves-service-on-midnight.md` and
are not repeated here. Decisions made in this repository are numbered `W1`, `W2`,
… so they cannot be confused with those.

State when this was written: `main` at `7a17c42`, CI green; the service live at
image `cf8f66b`; one registered project (campaign-foundry, 12 waves); neither
`@hexagen-monaco/waves-contract` nor `@hexagen-monaco/waves-client` is on npm
yet (`npm view` answers 404 for both). Both were published as 0.1.0 later the same
day; see W2.

## 1. Decisions

| id     | decision                                                                                                                                                                                                                                                                                                                                                                                                                                               | why                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W1** | **`seat` grows from 64 to 128 characters.** Nothing else about the field changes: 1 character minimum, no control characters.                                                                                                                                                                                                                                                                                                                          | campaign-foundry has free-text seats of up to 72 characters and truncated two of them to make its first push. Widening a bound is compatible under `waves/v1` (`docs/waves-v1.md` §7 lists only _narrowing_ as a breaking change); 128 leaves room without making the lane table unreadable.                                                                                                                  |
| **W2** | **The seat change ships as 0.1.1 of both packages.** 0.1.0 went to npm on 2026-10-02 before lane A1 ran. The contract 0.1.0 is sound, with the 64 cap. The client 0.1.0 is not installable: it was uploaded with `npm publish` from the package directory, so its dependency reads `workspace:^`, which npm refuses (`EUNSUPPORTEDPROTOCOL`). A1 bumps both versions; the owner publishes 0.1.1 from Yarn-packed tarballs and deprecates client 0.1.0. | A published version cannot be replaced, so the fix is the next patch. The client validates envelopes locally with the contract (`packages/client/src/application/push.ts`), so both packages have to move for a 72-character seat to get through.                                                                                                                                                             |
| **W3** | **The four UI findings from the pre-merge review of #8 and the two server findings from the review of #11 are fixed in wave A**, as an exception to "Lows are recorded, not chased".                                                                                                                                                                                                                                                                   | Two of them replace good lanes on screen with "0 lanes" and say nothing, on a page whose whole job is to be believed. The others are a line or two each and ride along.                                                                                                                                                                                                                                       |
| **W4** | **A cross-project "needs attention" view, computed by the server** and served as a new read route. No change to the envelope. It looks only at waves received in the last 72 hours and never lists a lane whose PR is merged or closed.                                                                                                                                                                                                                | It is the view the owner opens first, and it needs nothing a project does not already push. Computing it in the read model keeps the rule in one tested place and keeps the page to one request. The window and the finished-PR exclusion are what stop it filling with two weeks of failures that were already re-run: the envelope carries no "resolved" signal, so age and a finished PR stand in for one. |
| **W5** | **`prs` and `backlog` are wave C, and whether they are envelope keys at all is decided first (W8, open).** In campaign-foundry both are facts about one collection run of the whole repository, not about a wave: `prs` is a corpus gap `{ skipped }` (how many PR rows could not be read), and `backlog` is a tagged state `recorded` \| `absent` \| `unknown` with one `plan:verify` artifact per repository.                                        | D190/D191 planned them as envelope keys and v1 shipped lanes only. They are not "merged and queued PR lists": campaign-foundry's `tools/wave-status/lib/types.ts:178-191`, `backlog.ts:3-6` and `collect.ts:338-344` define them. Repeating a run-level fact in every wave's envelope would overstate it once per wave and say nothing about which wave it touches.                                           |
| **W6** | **Order: A, then B, then C.** The service is redeployed after each wave that changes the server, the contract or the page.                                                                                                                                                                                                                                                                                                                             | A unblocks the publish and the second consumer; B needs no contract change; C is the only one that changes what consumers send and so needs their agreement first. The contract counts because the image builds it in (`Dockerfile:22-25`): the live server keeps the 64 cap until it is redeployed.                                                                                                          |
| **W7** | **Notifications are not planned here.** They stay an open question for the owner (section 6).                                                                                                                                                                                                                                                                                                                                                          | They would be the first outbound call from a service that makes none today, and they hold a webhook secret. That is a design decision of its own, not a lane.                                                                                                                                                                                                                                                 |

## 2. Wave A — seat cap and recorded findings

Three lanes with disjoint source files, run in parallel.

### A1-seat-cap (normal)

- **Scope.** `MAX_SEAT_CHARS` 64 → 128 (`packages/contract/src/domain/envelope.ts:72`).
  A 128-character seat is accepted, a 129-character one is refused with the
  existing message, and the old boundary test
  (`packages/contract/__tests__/lane-reported.test.ts:33-44`) moves.
  `docs/waves-v1.md` §2.2 says 128. `version` becomes `0.1.1` in
  `packages/contract/package.json` and `packages/client/package.json`.
- **Files.** `packages/contract/**`, `packages/client/package.json`, the seat row
  of `docs/waves-v1.md`. There is
  no copy of the cap in the client or the page.
- **Must not.** Change any other bound; add a key; touch the server's source.

### A2-ui-findings (normal)

- **(a) A detail body for the wrong wave hides the lanes silently.** The check
  goes in `load()`, right after `api.wave(...)` (`public/app.js:78`): a body
  whose `envelope.wave` is not the wave that was requested is a failed load, and
  throws. `viewFor` (`app.js:88`) is **not** changed: its comparison with
  `selected` is what shows "No wave selected." after `onToggleAll` clears the
  selection without a load (`app.js:113-120`,
  `__tests__/ui/refresh.test.ts:423-439`).
- **(b) The single-wave response is not shape-checked**, so
  `{envelope:{wave,lanes:[]}}` replaces good lanes with "0 lanes" and shows no
  offline note. Add a `drawableWave` check and throw on failure, as the two list
  loads do. It must let `undefined` through: `api.js:17-19` answers `undefined`
  for a 404, and that is how a deleted wave reaches "That wave is no longer
  stored." (`wave.js:128`). A check that throws on it would turn every deleted
  wave into "offline, retrying" forever.
- **(c) `waveHead` (`public/wave.js:8`) does not check `intervalSeconds`**, so a
  bad value renders `every undefineds`: require `null` or a number.
- **(d) `app.d.ts` declares `refresh(): Promise<void>`** while the
  implementation resolves a boolean: declare `Promise<boolean>`.
- Each of (a)–(c) gets a test that fails with the fix reverted.
- **Files.** `packages/server/public/app.js`, `app.d.ts`, `wave.js`, `wave.d.ts`,
  `lanes.js`, `lanes.d.ts`, and the UI tests.
- **Must not.** Add an HTML sink or bypass `dom.js`; add a dependency; change any
  file outside `public/` and its tests.

### A3-probe-edges (normal)

- **(e) `/readyz` is answered before the method check**
  (`http-server.ts:186-195`), so `OPTIONS /readyz` is a 200. Gate that block on
  `GET` and `HEAD`; any other non-write method falls through to the 405 with
  `Allow: GET, HEAD`. The block is gated, not removed: it is the only thing
  that gives `/readyz` its `Cache-Control: no-store` (`extraFor` covers `/api/`
  only), and two tests assert it (`__tests__/http-guard.test.ts:365-371`,
  `__tests__/http-write.test.ts:980-984`).
- **(f) An `Expect` value other than `100-continue` gets Node's own bare 417**,
  with none of the security headers. Add a `checkExpectation` listener that
  answers 417 through `send`, passing `socket: req.socket` so an unread body is
  never drained — the same rule every pre-read write refusal follows
  (`http-security.ts:47-66`). The listener bypasses `handle`, so it writes the
  access-log line itself. The existing 417 assertion is in
  `__tests__/http-write.test.ts:927-947`; that test file may change, the source
  file `http-write.ts` may not.
- `docs/waves-v1.md` §5.1 and §5.3 lose the `/readyz` method exception and gain
  the 417.
- **Files.** `packages/server/src/infrastructure/http-server.ts`,
  `packages/server/__tests__/http-guard.test.ts`, `http-write.test.ts`, the two
  doc paragraphs.
- **Must not.** Change the order of any other check; make `/readyz` or
  `/healthz` require a token; change `http-write.ts`.

### Notes

- A1 and A3 both edit `docs/waves-v1.md`, in different sections. Both depend on
  PR #11 (the §5 rewrite) being merged first; A3 edits text that only exists
  after it.
- A2's pre-PR review re-runs each new test with its fix reverted. A test that
  still passes is vacuous and the lane goes back.
- After wave A, in this order: the owner publishes 0.1.1, contract first, then
  client. Each is packed by Yarn, which rewrites `workspace:^` to `^0.1.1`, and
  the tarball is what gets uploaded: `yarn pack --out <file>.tgz`, check the
  packed `package.json`, then `npm publish <file>.tgz --access public`. Plain
  `npm publish` in the package directory is what broke 0.1.0. The owner
  deprecates client 0.1.0. The orchestrator redeploys, because the live image
  still has the 64 cap and would answer 422 to a longer seat; then
  campaign-foundry is told it can stop truncating.

## 3. Wave B — the "needs attention" view

> **Superseded 2026-10-02 by `2026-10-02_waves-console.md`.** The rule below
> stands and is built there as lane K1; lanes B1 and B2 are withdrawn, and the
> fragment route chosen for B2 gives way to a path route (W11).

### What needs attention

One rule over every wave of every project that was **received in the last 72
hours**. A lane is listed when at least one of these holds; the reasons are
reported, not just the lane:

| reason         | condition                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `failed`       | `reported.event` is `failed`                                                                                      |
| `disagreement` | `disagreements` is not empty                                                                                      |
| `checks`       | `derived.pr.checks` is `fail`                                                                                     |
| `gate`         | `derived.gate.exit` is present and not `0`                                                                        |
| `exit`         | `derived.alive` is `false` and `derived.exit` is present and not `0`                                              |
| `silent`       | the wave is stale, the lane's `derived.alive` is `true` and it has no `derived.exit` — the pusher stopped mid-run |

A lane whose `derived.pr.state` is `merged` or `closed` is never listed, for any
reason: it is finished, and what its gate or its checks last said is history.
Staleness uses the server's receive time, as everywhere else
(`docs/waves-v1.md` §4), and `silent` starts from the condition under which the
wave view already shows `alive` as `unknown` (`read-model.ts:99-101`).

**Why `silent` also needs a missing `exit`.** Every wave ends up stale, because
pushes stop when it finishes, and `alive` is not a lifecycle state. In
campaign-foundry it is a process probe taken at collection time
(`tools/wave-status/lib/collect.ts:484-489`, `pgrep -f` on the lane's worktree
name), so a finished lane still reads `alive: true` whenever an orphaned test
process, a `tail -f` or a dev server has that name in its arguments. A lane with
an `exit` has finished whatever `alive` says, and one with a merged or closed PR
is already excluded; what is left is a lane that was running, never reported an
end, and went quiet. (Confirmed with campaign-foundry's orchestrator,
2026-10-02.)

### The route

`GET /api/v1/attention` answers
`{ lanes: [{ project, wave, lane, seat?, reasons, receivedAt, stale, pr? }], truncated }`,
newest receive first, at most 200 entries; `truncated` is `true` when more
matched. `pr` is the lane's PR number when it has one. The route needs a new
`Route` kind, its `ALLOWED` entry and a `replyFor` case; the viewer-token guard,
`Cache-Control: no-store` and the 405 for writes then apply to it with no
further change. It reads snapshots through the existing `listSnapshots` port; no
store change.

It carries no `log.tail`, no `detail` and no prose fields: the view links to the
wave, where the full lane already is.

### Lanes

Sequential: B2 is written against B1's merged route.

**B1-attention-api (normal)**

- **Scope.** The rule as a pure function with a test per reason and per
  exclusion. It takes snapshots and a clock value and imports nothing, so it
  belongs in `domain/` by the layer rule in `AGENTS.md`. `listAttention` on the
  read model; the route; a new §5 entry in `docs/waves-v1.md` with the response
  shape and the reason table.
- **Files.** `packages/server/src/domain/**`, `application/read-model.ts`,
  `infrastructure/http-routes.ts`, `infrastructure/http-server.ts`, tests, the
  doc.
- **Must not.** Change the envelope or the contract package; add a write; read
  anything but the store port.

**B2-attention-ui (high)**

- **Scope.** A panel at the top of the project list page (`/`) showing the
  attention list — project, wave, lane, reasons as badges, age — each row an
  internal link to that project's page with that wave selected. An empty list
  says so in one line. The response is shape-checked before it is drawn, and
  that check enforces the project and wave id patterns itself, because `public/`
  cannot import the contract. A failed load keeps the last good list and shows
  the offline note, like the other views.
- **Links.** `internalLink` is documented as taking a path "the app owns and
  never takes from the API" (`dom.js:90`). These rows build a path from API
  fields, so each segment is pattern-checked, then `encodeURIComponent`-ed under
  the fixed `/p/` prefix, and the comment is updated to say what is now true.
- **Selecting the wave.** The page takes the wave from a fragment
  (`/p/<id>#<wave>`), which adds no server route. `AppGlobals.location` is
  `{ pathname }` only (`app.d.ts:10`) and gains `hash`.
- **Files.** `packages/server/public/**`, the UI tests.
- **Must not.** Add an HTML sink or bypass `dom.js`; add a dependency; change
  any server source.

B2 is high risk for the reason #8 was: it renders strings that other projects
chose. Every field of the attention response goes through the XSS test's
payload set, and the ESLint ban on HTML sinks stays green without a disable
comment.

## 4. Wave C — `prs` and `backlog`

This wave changes what consumers send, so it starts with a decision, not a
lane.

### What campaign-foundry has (its orchestrator, 2026-10-02)

- **`prs`** is `{ skipped }`, attached only when a `gh` PR listing returned rows
  no parser could read. There is one listing per collection, so it is one number
  for the run. Both of its renderers show a single warning.
- **`backlog`** is one `plan:verify` artifact per repository. Its renderers show
  exactly: the state; `at`; `scope.kind` (`full` \| `partial`) with the plan
  names; `git.branch` and `git.head`; and `premises[]`, each `lane`, `plan`,
  `status` (`holds` \| `stale` \| `timed-out` \| `error`) and an optional
  `reason`. Nothing else in the artifact is read.

A closed summary that covers both renderers:

```
{ state, at?, scope?: { kind, plans: string[] }, git?: { branch, head },
  premises?: [{ lane, plan, status, reason? }] }
```

### W8, decided: project-level status (owner, 2026-10-03)

Both are facts about a project at a moment, not about a wave. Two options:

| option                                 | what it is                                                                                                                                                                                                                   | cost                                                                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project-level status (recommended)** | A new write, `PUT /api/v1/projects/<id>/status`, with the project token, carrying `{ schema, project, generatedAt, prs?, backlog? }`; the project list and the project page show it once. The wave envelope does not change. | A second validated document in the contract, a second stored file per project, and a second push from the client. Staleness applies to it as it does to a wave. |
| Envelope keys                          | `prs` and `backlog` as optional keys of the wave envelope, as D191 wrote it.                                                                                                                                                 | The same run-level fact is stored and shown once per wave, and the page has to pick which wave's copy to believe.                                               |

The owner chose the recommended option on 2026-10-03: a project-level status document behind `PUT /api/v1/projects/<id>/status`; the wave envelope does not change. Either way the contract's rules
hold: closed objects; every string bounded and free of control characters;
every array capped (`plans`, `premises`); no opaque blob.

### Lanes, once W8 is decided

1. **C1-contract (normal).** The new shapes, their readers and bounds, tests,
   and `docs/waves-v1.md`. The contract takes a minor version. It also tightens
   a project's `repo`: only the characters a URL may hold unescaped, so a
   placeholder such as `https://github.com/<owner>/<repo>` is refused rather than
   stored (found in the first real `register-all` setup, 2026-10-03).
2. **C2-server-and-page (high).** Storing and serving them; the page renders
   them through `dom.js`, and the XSS test covers every new field.
   campaign-foundry's own page builds its backlog view with `innerHTML` and an
   escape helper: none of that code is ported.
3. **C3-client (normal, required).** The client does not pass an envelope
   through: it rebuilds one from `lanes` alone (`lanesOf` and `buildEnvelope`,
   `packages/client/src/domain/envelope.ts:44-70`), so anything else in a
   consumer's input is dropped today before validation. C3 carries the new data
   — as a second command or as envelope keys, per W8 — and moves the client's
   dependency range, since `^0.1.0` does not admit a 0.2.0 contract.

C1 (#34), C2 and C3 (#35) are the three lanes of this wave. C3 adds
`waves status`, which sends the project status document, and the contract's
`repo` refuses a user or a password.

Rollout order is fixed by the closed-object rule (`docs/waves-v1.md` §7): a
reader that does not know a key refuses it, and a server that does not know a
route answers 404 or 405. The server is deployed first, then the contract and
client are published, and only then does a consumer upgrade and start sending.
A new client against an old server gets a refusal, which the client reports as
a failed push (exit 1) and which, by D197, a consumer treats as a warning.

## 5. How each wave runs

The standing rules, restated so a brief can cite one place:

- Lanes run on the owner's opencode server through `ocm-run`, one worktree per
  lane, brief inside the worktree under an ignored path. Lanes cannot push; the
  orchestrator fetches, verifies and opens the PR.
- A brief opens with "prove the gap", lists exact files and fields, and ends
  with the two standing sentences about wrong findings and foreground
  verification. One file per tool call, under 250 lines.
- The orchestrator never trusts a lane's exit code: it counts commits against
  the tip recorded before dispatch and runs the full gate on the Mac —
  `yarn build && yarn typecheck && yarn lint && yarn format:check && yarn test:cov`,
  coverage 100/100/100/100. The full gate never runs on midnight.
- Every brief and every pre-PR diff gets a read-only review by a different
  model than the implementer. High-risk lanes get a separate brief review.
- No AI attribution in commits or PRs. Squash-merge with an explicit subject
  and body when CI is green.
- A contract change that affects consumers is announced to campaign-foundry's
  orchestrator before it merges.
- Deploy with `sh deploy/deploy.sh` from a clean `main` that is on
  `origin/main`, then run the deploy-time checks in `deploy/README.md`.

## 6. Not planned, kept as candidates

Nothing here is scheduled. Each needs its own decision before it becomes a lane.

| candidate                                | note                                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notifications (webhook or ntfy)          | **Not built (W7, owner, 2026-10-03: the default stands).** Stale wave, failed lane, wave fully merged. First outbound call; holds a secret; needs an allow-list of destinations.      |
| NetworkPolicy: ingress from Traefik only | `deploy/README.md` recommends it and neither the base nor the midnight overlay ships one. Small, and it is what makes `WAVES_TRUST_PROXY=1` safe in-cluster.                          |
| Backup as a CronJob                      | The weekly `projects.json` copy is a manual command today.                                                                                                                            |
| PR links on lanes                        | The https-only external link already exists (`anchor`, `repoLink`, `dom.js:66-99`). What is missing is the decision to compose `<repo>/pull/<number>`, which assumes GitHub's layout. |
| Wave history (last N snapshots)          | Contradicts D194 ("latest only; history stays in each project's logs"), so it is a decision to reverse, not a feature to add.                                                         |
| Lane usage (`usage`: seconds, tokens)    | An additive lane field; wait for wave C to settle how additive fields roll out.                                                                                                       |
| Server-sent events                       | Replaces polling; a long-lived connection through the ingress.                                                                                                                        |
| `waves init`, a GitHub Action            | Onboarding for a second consumer; revisit when hexagen-monaco registers.                                                                                                              |
| Token last-used time                     | Makes a forgotten or leaked project token visible.                                                                                                                                    |
