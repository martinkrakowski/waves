# Plan: automated project registration

Owner decision, 2026-10-02 (relayed by the campaign-foundry session): automate
project registration with **an enrollment token** and **a `waves register-all`
command run on a schedule**. Today every project is registered by the owner by
hand with the admin token, and a new project (`client-portal` is the next one)
waits for that.

Decisions continue the numbering of `2026-10-02_waves-console.md` (W17 was
its last). The owner confirmed three choices on 2026-10-02: the ceiling of 64
(W23), an hourly run plus one at login (W28), and that a `409` is logged on
every run without failing it (W27).

## 1. What is built

1. **An enrollment token.** A second, optional secret on the server. It can do
   one thing: create a project that does not exist yet. It cannot rotate a
   token, delete a project, or touch any other route. The admin token keeps
   every power it has.
2. **`waves register --enrollment-token-file`**: the existing command, with the
   enrollment token as a third way to authenticate.
3. **`waves register-all`**: reads a list of projects the owner maintains and
   registers each one that has no token file on this machine.
4. **A launchd LaunchAgent** on the owner's Mac that runs `register-all` once an
   hour, with an install and an uninstall script.

## 2. Why it runs on the Mac

Registration answers with the project's token **once**, and every push reads
`~/.config/waves/<id>.token` on the machine that pushes. The pushes run on the
owner's Mac. A schedule anywhere else (a CronJob on midnight, say) would mint
tokens that no pusher ever receives, and each one would then need an admin
rotation to recover. So the schedule is a LaunchAgent on the Mac, not cron and
not Kubernetes.

## 3. Decisions

| #       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W18** | **The enrollment token is a second Secret, `waves-enroll`** (key `token`), mounted read-only at `/run/secrets/waves-enroll/token` and named by `WAVES_ENROLL_TOKEN_FILE`. Same value rule as the admin token (32 to 128 characters of `A-Z a-z 0-9 _ -`), read once at startup; an unreadable or malformed file refuses startup. **When both files are present and hold the same value, the server refuses to start**: an enrollment file equal to the admin token would carry every admin power to wherever the enrollment copy lives. The Secret is optional: without it, enrollment is disabled, and startup logs `waves: enrollment disabled` as it does for the admin token. The owner creates it from a 0600 file, exactly as `waves-admin` is made; no agent ever holds either value. Revocation is deleting the Secret and restarting the deployment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **W19** | **What the enrollment token may do: `POST /api/v1/projects` with no query, for an id that does not exist.** An existing id answers `409`, as it does for the admin token. `?rotate=1` and `DELETE /api/v1/projects/<id>` under it answer `403` (`enrollment token cannot do this`), charged to the address's failure window like a `401`. A push or a wave delete under it answers `401`, as any token that is not a project token does: the project-write path is not changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **W20** | **The admin token is unchanged.** It still does everything it does today, including create. A register or delete request is authenticated by comparing the presented digest against **both** expected digests, unconditionally and with no early return, through the existing `timingSafeEqual` comparer. The result is a kind, `admin`, `enroll` or `none`; a pure `authorize(route, rotate, kind)` then decides. The response time depends on which tokens are configured, never on what was presented.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **W21** | **Disabled means absent.** A route answers `404` exactly when no configured token could ever authorize it: `POST /api/v1/projects` is 404 only when neither token is configured; `?rotate=1` and `DELETE` are 404 when the admin token is not configured, whatever the enrollment token. A probe cannot tell a disabled route from a path that never existed. This needs the query before the 404 step, so the order of checks changes in one place: the query is parsed first, then the 404 is decided per route, `rotate` and the tokens configured. `docs/waves-v1.md` §5.4 steps 2 and 3 are rewritten to match.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **W22** | **Same order otherwise, same limits.** Authentication still comes before the body is read; the per-address failure limit (ten in sixty seconds) and the shared admin write allowance (one request a second, `PROJECT_INTERVAL_MS`) apply to enrollment requests too, at the same rate. (Amended in R1: the enrollment token has its own limiter key rather than the admin routes' one, so a leaked enrollment token cannot hold the admin token's cleanup at `429`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **W23** | **A ceiling on what enrollment can create: 64 projects in the registry**, counting every project however it was registered. It is decided where the `409` is, after the body, in one serialized store operation: `StorePort.createProject(project)` → `created`, `exists` or `ceiling`, used when the kind is `enroll`. So two concurrent enrollments of one id cannot both win, and two at 63 projects cannot both pass. Past the ceiling an enrollment answers `403` (`enrollment ceiling reached`), **not** charged to the failure window, and the admin token still registers. A leaked enrollment token can fill the registry to a known size and no further. The ceiling is a constant, not configuration. It bounds the registry's size, not what is in it (see §6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **W24** | **The server logs each enrollment** as one JSON line through the same `log` as the access log (the write handler gains one), naming the id and that the enrollment token created it, never a token or a digest, so the owner can tell enrolled projects from hand-registered ones after the fact.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **W25** | **The client takes the enrollment token from a file (`--enrollment-token-file <path>`) or standard input (`--enrollment-token-stdin`), never argv or the environment**, and the file passes the same 0600 trust check as the admin token file. The two enrollment flags and the two admin flags are mutually exclusive; `--rotate` with an enrollment flag is refused locally with exit 2 before any request.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **W26** | **`register-all` reads `~/.config/waves/projects.json`** (`WAVES_CONFIG_DIR` overrides the directory; `--projects <path>` overrides the file): a JSON array of `{ "id", "name", "repo"? }`. Every entry is validated before any request: the contract's id rule, a name the server would accept, an https-only repo with no credentials, no duplicate ids, at most 64 entries (skipped ones included; the number happens to equal W23's ceiling, which counts the registry), and no other key. One invalid entry fails the whole run with exit 2 and sends nothing. The file is the owner's own and is read without the 0600 trust check a token file gets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **W27** | **For each entry, in order:** a token file already there → counted as skipped, no request (the file is not opened: a stale or unreadable one is still skipped, as `register` treats it). Otherwise register with the enrollment token and write the token file 0600 atomically, exactly as `register` does. Requests are paced at least one second apart (the server's write allowance), and a `429` is retried by `decideRetry`'s throttled branch exactly as `push` does, so N new entries take about N seconds. `201` → `registered <id>`. `409` → `<id> is registered and its token is not on this machine (registered elsewhere, or lost after a cut connection); recover it with an admin rotate or remove the entry`, and the run goes on: it never rotates. A `401` or `403` aborts the run after one line: the credential is wrong for every entry, and going on would spend the address's failure allowance. Any other failure → one line, the run goes on. The run ends with one summary line, `N skipped, M registered, K conflicts, J failed`; skip lines are printed only with `--verbose`. Never a token. Exit 0 when nothing failed (a `409` is a state for the owner, printed on every run until it is resolved, not a failure of the job), 1 when a request failed or the run aborted, 2 for a usage or validation error. |
| **W28** | **The schedule is a launchd LaunchAgent**, `cloud.krakowski.waves.register-all`, in `~/Library/LaunchAgents/`, with `RunAtLoad` and `StartInterval` 3600. The plist runs `/bin/sh` on a small wrapper the install script writes to `~/Library/Application Support/waves/register-all.sh`, which holds the absolute paths of `node` and the client's `bin` from the global install the script found. When either path no longer exists (an nvm upgrade moves both), the wrapper writes one dated line saying so and naming `install.sh` to the log, and exits 1, so the log never just goes quiet. `WAVES_URL` is set through `EnvironmentVariables`; `WAVES_CA_FILE` is not, because the client already reads `~/.config/waves/ca.crt` when it is there. stdout and stderr go to `~/Library/Logs/waves-register-all.log`. The repository ships the plist template, the wrapper template, `deploy/launchd/install.sh` and `uninstall.sh`; the owner runs them, and re-runs `install.sh` after a node upgrade (it is idempotent). The install script refuses if the enrollment token file is missing or not 0600, and never reads or prints it.                                                                                                                                                                                               |
| **W29** | **The list is the owner's.** The owner maintains `projects.json`. The hexagen template may append an entry when it generates a project (its own change, not in this plan). Auto-discovery from repositories that declare a waves id is not in v1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## 4. Lanes

### R1-enrollment-server (high)

- **Scope.** `WAVES_ENROLL_TOKEN_FILE` in `application/config.ts`; a reader
  beside `infrastructure/admin-token.ts` (share its validation, do not copy
  it); `main.ts` passes the enrollment token to the write handler;
  `main.ts` passes it through `createHttpServer`'s deps; `http-write.ts`
  implements W19 to W24 in the existing order of checks except that the
  disabled-404 step now reads the query (W21). The kind is computed by
  comparing both digests (W20); the decision is one pure function,
  `authorize(route, rotate, kind)` → `admin | enroll | refuse(status)`,
  unit-tested over the whole table. The store port gains
  `createProject(project)` → `created | exists | ceiling`, serialized like
  `putProject`, and the enrollment path uses it (W23). The equal-tokens refusal
  (W18) is at startup. `packages/server/__tests__/deploy-manifests.test.ts`
  changes with the manifest. `deploy/k8s/base/deployment.yaml` gains the optional Secret
  volume and the variable, as `waves-admin` has them. `docs/waves-v1.md` §5
  and `deploy/README.md` document the token, its powers, its absence and its
  revocation.
- **Tests.** The enrollment token creates; it cannot rotate or delete (403),
  push or drop a wave (401), or re-register an existing id (409); two
  concurrent enrollments of one id: one 201, one 409; equal tokens refuse
  startup; the admin token is unaffected
  with and without the enrollment Secret; enrollment is disabled (404) when its
  Secret is absent; each refusal is charged to the failure window; the
  ceiling; the log line holds no token; both digests are compared on every
  register request (a counting comparer in the test).
- **Mutations.** One per refusal: rotate allowed, delete allowed, push allowed
  under the enrollment token, the 409 skipped, the ceiling off by one, the 404
  rule inverted, the second comparison short-circuited, equal tokens accepted
  at startup, the existence check taken outside the serialized create.
- **Must not.** Touch any read route; widen what the admin token can do; read
  either token from the environment; log a token or a digest.

### R2-register-all-client (normal), parallel with R1

- **Scope.** `packages/client`: the enrollment flags on `register` (W25);
  `register-all` (W26, W27) as its own use case beside `application/register.ts`,
  sharing its save-and-report path rather than copying it; the usage text; the
  client README.
- **Tests.** Parsing and every mutual exclusion; `--rotate` with enrollment
  refused before any request; two new entries in one run against a stub that
  answers 429 then 201; a 401 aborting the run after one line; the summary
  line and `--verbose`; the list's validation (each rule, and that
  nothing is sent when one entry is bad); skip / 201 / 409 / failure per entry
  against a stubbed transport; exit codes; that no output line holds the
  token; the token file's mode and atomic write.
- **Mutations.** Skip check removed (a request for a project whose token is
  present); a 409 that rotates; validation after the first request; a token in
  the output; exit 0 after a failure; pacing removed; the run going on after a 401.

### R3-launchd (low), after R2

- **Scope.** `deploy/launchd/cloud.krakowski.waves.register-all.plist.template`,
  `install.sh` (POSIX `sh`, `set -eu`: checks the token file exists with mode
  0600 without reading it, finds `node` and the client's bin, renders the
  template with absolute paths, `launchctl bootstrap gui/$(id -u)`), and
  `uninstall.sh` (`launchctl bootout`, removes the plist, leaves the log and
  the tokens). `deploy/README.md` gains an "Automatic registration" section
  with the owner's steps.
- **Tests.** A shell test run in CI (Linux) that renders both templates into a
  temp directory, checks the plist with `xmllint --noout` (`plutil -lint` is a
  local check only, CI has none), runs the wrapper with a missing node path and
  expects its one log line and exit 1, and checks that install refuses a
  missing or 0644 token file. Nothing in CI calls `launchctl`.

### Order and deploy

R1 and R2 in parallel; R3 after R2. The server deploys after R1 merges (the
enrollment route stays disabled until the owner creates the Secret, so the
deploy changes nothing on its own). The client is published as 0.2.0 after R2.

## 5. The owner's steps, once it ships

1. Create the Secret from a 0600 file, never through an agent:
   `umask 077; cat > /root/waves-enroll-token; kubectl -n waves create secret generic waves-enroll --from-file=token=/root/waves-enroll-token; kubectl -n waves rollout restart deploy/waves`.
2. Put a copy at `~/.config/waves/enroll.token`, mode 0600.
3. Write `~/.config/waves/projects.json`, for example
   `[{ "id": "client-portal", "name": "Client Portal", "repo": "https://github.com/…" }]`.
   `campaign-foundry` may be listed too: its token is present, so it is skipped.
4. `npm i -g @hexagen-monaco/waves-client@0.2.0`, then `sh deploy/launchd/install.sh`.
5. Read `~/Library/Logs/waves-register-all.log` after the first run.
6. To rotate the enrollment token: delete the Secret, create it from a new
   0600 file, `kubectl -n waves rollout restart deploy/waves`, and replace
   `~/.config/waves/enroll.token`. Runs between the restart and the local
   replacement abort on a 401, which the log says.
7. After a node upgrade, re-run `sh deploy/launchd/install.sh`.

## 6. Risk and review

R1 is high risk: a new credential on a network-exposed write path. It gets a
brief review and a pre-PR review, and the pre-PR review is asked specifically
for the authorization table, the 404/403 split, timing, and the failure
accounting. R2 handles a credential and writes token files; it gets both
reviews too. The deploy-time checks in `deploy/README.md` gain three: an
enrollment `POST` with the Secret absent answers 404; with it present, a
`?rotate=1` under the enrollment token answers 403; a `DELETE` under it answers 403.

What the design accepts, said so the R1 review weighs it: with the admin
Secret absent and the enrollment Secret present, an unauthenticated
`POST /api/v1/projects` answers 401 while `?rotate=1` answers 404, so a probe
can learn that a second token exists (not its value, nor which token anyone
presented). And a leaked enrollment token can squat an id before the owner's
run registers it, and holds the token of each project it creates, so it can push
snapshots the console renders. The ceiling bounds how many; revocation and an
admin delete are the remedy.

## 7. Not in this plan

Auto-discovery of projects; the hexagen template's append; per-project
enrollment tokens or expiring tokens; any web UI for registration.
