# The `waves/v1` contract

Every rule below is taken from the code, not from prose. The section footers
name the file each rule came from.

## 1. Purpose

A project that orchestrates delegated waves pushes, on its own schedule, one
versioned snapshot of each wave it owns; one small server collects those
snapshots from every project and renders them all into a single status view.
Pushing is opt-in — a project that never pushes contributes nothing and is
simply absent — and a failed push never fails the pusher's own work, so a
status service that is down, slow or refusing the payload must never be able to
break a build.

## 2. The envelope

`validateEnvelope` is the whole gate. It is exported from
`@hexagen-monaco/waves-contract` and is pure: give it a parsed JSON value, get
either `{ ok: true, value }` or `{ ok: false, errors }`.
(`packages/contract/src/domain/envelope.ts`, `packages/contract/src/index.ts`)

### 2.1 Top level

Closed object: an unknown key is an error (`readClosedObject`,
`packages/contract/src/domain/validation.ts:271`). The accepted keys are
exactly `ENVELOPE_KEYS`
(`packages/contract/src/domain/envelope.ts:43`).

| field             | type              | required | bounds                                                                     |
| ----------------- | ----------------- | -------- | -------------------------------------------------------------------------- |
| `schema`          | string            | yes      | exactly `"waves/v1"` (`SCHEMA`, `packages/contract/src/domain/model.ts:3`) |
| `project`         | string            | yes      | `^[a-z0-9][a-z0-9-]{0,62}$`, so 1 to 63 characters                         |
| `wave`            | string            | yes      | `^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$`, so 1 to 80 characters                  |
| `generatedAt`     | string            | yes      | strict ISO-8601 UTC, see 2.5                                               |
| `intervalSeconds` | integer or `null` | yes      | 1 to 300 inclusive, or `null` for the 300 s default                        |
| `lanes`           | array             | yes      | at most 200 entries, see 2.3                                               |

`project` and `wave` patterns are `PROJECT_ID_PATTERN` and `WAVE_ID_PATTERN` in
`packages/contract/src/domain/ids.ts:7`; `lane.id` uses the wave pattern.
`intervalSeconds` is required as a key but `null` is a legal value
(`readIntervalSeconds`, `packages/contract/src/domain/envelope.ts:135`).

### 2.2 A lane

Closed object; keys exactly `id`, `seat`, `reported`, `derived`,
`disagreements` (`packages/contract/src/domain/envelope.ts:51`).

| field           | type             | required | bounds                                          |
| --------------- | ---------------- | -------- | ----------------------------------------------- |
| `id`            | string           | yes      | 1 to 80 characters, `A-Za-z0-9_-`               |
| `seat`          | string           | no       | 1 to 64 characters, no control characters       |
| `reported`      | object           | no       | see 2.4                                         |
| `derived`       | object           | yes      | see below                                       |
| `disagreements` | array of strings | yes      | at most 20 entries, each at most 300 characters |

`derived` is a closed object with keys `alive`, `exit`, `gate`, `pr`, `diff`,
`log`, `planReview`, `risk`
(`packages/contract/src/domain/envelope.ts:53`):

| field        | type    | required | bounds                                               |
| ------------ | ------- | -------- | ---------------------------------------------------- |
| `alive`      | boolean | yes      | —                                                    |
| `exit`       | integer | no       | any integer, positive or negative                    |
| `gate`       | object  | no       | `{ exit?: integer, coverage?: object }`              |
| `pr`         | object  | no       | `{ number, state, checks, unresolvedThreads? }`      |
| `diff`       | object  | no       | `{ files, insertions, deletions }`, all integers ≥ 0 |
| `log`        | object  | no       | `{ bytes, mtimeMs, tail? }`                          |
| `planReview` | string  | no       | at most 200 characters                               |
| `risk`       | string  | no       | at most 200 characters                               |

Each nested object is closed as well. `gate.coverage` takes exactly
`statements`, `branches`, `functions`, `lines`, each a **finite number** in
0 to 100. `pr.state` is `open` | `merged` | `closed`; `pr.checks` is
`none` | `pending` | `pass` | `fail` | `unknown`; `pr.number` is an integer ≥ 1;
`pr.unresolvedThreads` is an integer ≥ 0 or the string `"unknown"`.
`log.bytes` is an integer ≥ 0, `log.mtimeMs` a finite number ≥ 0, and `log.tail`
a string of at most 4096 bytes in which tab and newline are allowed. Omitting a
key inside a nested object that is present is an error, because the reader
validates each field rather than defaulting it — except the explicitly optional
ones above.
(`packages/contract/src/domain/envelope.ts:51-67`, `233-421`)

### 2.3 Count caps

- `lanes` at most 200 (`MAX_LANES`, `packages/contract/src/domain/envelope.ts:71`).
- `disagreements` at most 20 per lane (`MAX_DISAGREEMENTS`, `…/envelope.ts:76`).
- `detail` at most 256 keys in total, nested (`MAX_DETAIL_KEYS`, `…/envelope.ts:79`).
- `detail` at most 8 levels deep, counting the `detail` object itself as level 1
  (`MAX_DETAIL_DEPTH`, `…/envelope.ts:78`).

### 2.4 `reported`

Closed object; keys exactly `stage`, `event`, `ts`, `pr`, `round`, `detail`
(`packages/contract/src/domain/envelope.ts:52`).

| field    | type    | required | bounds                                                                |
| -------- | ------- | -------- | --------------------------------------------------------------------- |
| `stage`  | string  | yes      | `^[a-z][a-z-]{0,31}$`, so 1 to 32 characters, lower case, `-` allowed |
| `event`  | string  | yes      | `started` \| `settled` \| `failed`                                    |
| `ts`     | string  | yes      | strict ISO-8601 UTC                                                   |
| `pr`     | integer | no       | ≥ 1                                                                   |
| `round`  | integer | no       | ≥ 0                                                                   |
| `detail` | object  | no       | ≤ 8192 serialized bytes, see 2.6                                      |

### 2.5 Timestamps

`generatedAt` and `reported.ts` must match
`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/` — four-digit year, no
offset other than `Z`, and at most three fractional digits — and must also
round-trip: the validator compares the first 19 characters against
`new Date(text).toISOString()`, so `2026-02-30T00:00:00Z` is rejected even
though the pattern matches. (`packages/contract/src/domain/validation.ts:20`,
`83-92`)

### 2.6 Byte caps, control characters and reserved keys

- The whole envelope, re-serialised as UTF-8 JSON, must be at most 1 MiB =
  1 048 576 bytes, else one error at the root (`MAX_INPUT_BYTES`,
  `packages/contract/src/domain/validation.ts:17`).
- `reported.detail` must be at most 8 KiB = 8192 bytes re-serialised
  (`MAX_DETAIL_BYTES`, `packages/contract/src/domain/envelope.ts:73`).
- `derived.log.tail` must be at most 4 KiB = 4096 bytes, measured as bytes and
  not characters (`MAX_TAIL_BYTES`, `…/envelope.ts:74`).
- Any character below `0x20`, and `0x7f`, is a control character and is refused
  in every string the validator reads — keys of `detail` included, where the
  message is `a key contains a control character`. Tab and newline survive only
  where the rule allows line breaks: `log.tail` and `detail` string values.
  (`packages/contract/src/domain/validation.ts:58-81`, `…/envelope.ts:184-186`)
- The keys `__proto__`, `constructor` and `prototype` are refused anywhere
  inside `detail`, at any depth (`FORBIDDEN_DETAIL_KEYS`,
  `packages/contract/src/domain/envelope.ts:81`).
- `detail` may hold any JSON value — strings, numbers, booleans, `null`,
  arrays, objects. The only rules on it are the byte cap, the depth cap, the key
  budget, the control-character rule and the reserved keys.
  (`detailProblem`, `packages/contract/src/domain/envelope.ts:157-231`)

### 2.7 A minimal valid envelope

```json
{
  "schema": "waves/v1",
  "project": "apollo",
  "wave": "wv6",
  "generatedAt": "2026-02-14T09:15:00Z",
  "intervalSeconds": 30,
  "lanes": [
    { "id": "lane-a", "derived": { "alive": true }, "disagreements": [] }
  ]
}
```

### 2.8 A full valid envelope

```json
{
  "schema": "waves/v1",
  "project": "apollo",
  "wave": "wv6",
  "generatedAt": "2026-02-14T09:15:00.250Z",
  "intervalSeconds": 45,
  "lanes": [
    {
      "id": "lane-a",
      "seat": "reviewer-1",
      "reported": {
        "stage": "verify",
        "event": "settled",
        "ts": "2026-02-14T09:14:58Z",
        "pr": 412,
        "round": 3,
        "detail": {
          "tests": { "passed": 1204, "failed": 0, "skipped": 3 },
          "notes": ["gate green", "tail is 4 KiB at most"],
          "durationMs": 4210
        }
      },
      "derived": {
        "alive": true,
        "exit": 0,
        "gate": {
          "exit": 0,
          "coverage": {
            "statements": 99.4,
            "branches": 97.1,
            "functions": 100,
            "lines": 99.6
          }
        },
        "pr": {
          "number": 412,
          "state": "open",
          "checks": "pass",
          "unresolvedThreads": 0
        },
        "diff": { "files": 12, "insertions": 480, "deletions": 64 },
        "log": {
          "bytes": 184320,
          "mtimeMs": 1771058098000,
          "tail": "all green\n"
        },
        "planReview": "plan matches the brief",
        "risk": "none seen"
      },
      "disagreements": ["reported settled, gate still running"]
    },
    {
      "id": "lane-b",
      "seat": "reviewer-2",
      "reported": {
        "stage": "implement",
        "event": "failed",
        "ts": "2026-02-14T09:12:03Z"
      },
      "derived": {
        "alive": false,
        "exit": 1,
        "pr": {
          "number": 411,
          "state": "open",
          "checks": "fail",
          "unresolvedThreads": "unknown"
        }
      },
      "disagreements": []
    }
  ]
}
```

## 3. Errors

A failure is a list of issues, each exactly `{ path, message }`
(`ValidationIssue`, `packages/contract/src/domain/validation.ts:1`). `path` is
an RFC 6901 JSON pointer: `""` is the root, `/lanes/0/derived/alive` points at
a field, and `~` and `/` inside a key are escaped as `~0` and `~1`
(`ROOT_PATH`, `escapeToken`, `…/validation.ts:14`, `54-56`). At most 50 issues
are ever reported; further problems are dropped silently
(`MAX_ISSUES`, `…/validation.ts:16`, `22-30`).

## 4. Staleness and retention

A wave goes stale when it has not been received for longer than
`staleAfterMs(intervalSeconds)`:

- `intervalSeconds === null` → 300 000 ms.
- otherwise `min(3 × intervalSeconds, 300) × 1000` ms.

`isStale(lastPushMs, intervalSeconds, nowMs)` is `nowMs - lastPushMs > that`
(`packages/contract/src/domain/staleness.ts:1-18`).

`isRetained(lastPushMs, nowMs)` is `nowMs - lastPushMs <= 14 × 24 × 60 × 60 ×
1000`, so a snapshot is retained for 14 days after its last receive
(`RETENTION_MS`, `packages/contract/src/domain/staleness.ts:3`, `20-22`).

The clock is always the server's, and the instant it uses is always the time the
server **received** the snapshot — `receivedAt` — never the pusher's
`generatedAt`. Every formula is fed `Date.parse(receivedAt)` and `now()` from
the server (`createReadModel`, `packages/server/src/application/read-model.ts:86`,
`133-153`; `Now`, `…/read-model.ts:14`). `generatedAt` is stored and echoed but
no rule reads it.

In the wave view, a stale wave keeps its lane data but a lane whose
`derived.alive` is `true` is rendered as `"unknown"`, because the pusher has
stopped telling the server whether the process is still up
(`aliveView`, `…/read-model.ts:75-77`).

## 5. HTTP API

### 5.1 Read routes, served today

Only `GET` and `HEAD` are answered; anything else is `405` with
`Allow: GET, HEAD` (`READ_METHODS`, `ALLOW_GET_HEAD`,
`packages/server/src/infrastructure/http-server.ts:39`,
`packages/server/src/infrastructure/http-security.ts:11`).

| path                                     | 200 response                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /healthz`                           | `{"ok":true}`                                                                                                                              |
| `GET /api/v1/projects`                   | array of `{ id, name, repo?, registeredAt, waves, lastPush? }`, `waves` a count, `lastPush` the newest `receivedAt` in the project         |
| `GET /api/v1/projects/<id>/waves`        | array of `{ wave, receivedAt, intervalSeconds, lanes, stale, retained }`, newest receive first                                             |
| `GET /api/v1/projects/<id>/waves/<wave>` | `{ envelope, receivedAt, stale, staleAfterMs }`, where `envelope` is the stored envelope with `lanes[].derived.alive` possibly `"unknown"` |
| `GET /` and `GET /p/<id>`                | the status page (`public/index.html`)                                                                                                      |
| `GET /<static file>`                     | a file from `public`, allow-listed extensions only                                                                                         |

(`route`, `packages/server/src/infrastructure/http-routes.ts:33`;
`replyFor`, `packages/server/src/infrastructure/http-server.ts:69`;
`ProjectSummary`, `WaveSummary`, `WaveView`,
`packages/server/src/application/read-model.ts:18-49`;
`SnapshotHead`, `packages/server/src/application/ports/store.ts:8-13`)

Status codes, in the order the server decides them
(`packages/server/src/infrastructure/http-server.ts:121-153`):

- `200` with the shape above.
- `404` `{"error":"not found"}` — an unknown project, an unknown wave, a path
  that is not a route, or a static file that is not there. A `project` or
  `wave` segment that fails the id pattern is not a route at all, so it is a
  `404` and never reaches the store
  (`packages/server/src/infrastructure/http-routes.ts:43-52`).
- `405` `{"error":"method not allowed"}` with `Allow: GET, HEAD`.
- `414` `{"error":"uri too long"}` — a request target over 2048 bytes
  (`MAX_URL_BYTES`, `packages/server/src/infrastructure/http-routes.ts:7`).
  This is checked before authentication, so an oversized target is a `414`
  even without a token.
- `431` `Request Header Fields Too Large` — a header block over 16 KiB
  (`MAX_HEADER_BYTES`, `packages/server/src/infrastructure/http-server.ts:43`).
  The request never becomes a request, so the answer is written straight to
  the socket by hand and carries no body; `408` and `400` come from the same
  place for a timed-out or otherwise unparseable request
  (`parserRefusal`, `packages/server/src/infrastructure/http-security.ts:89-111`;
  `refuseParsedRequest`, `…/http-security.ts:119-137`).
- `500` `{"error":"internal"}` — anything that throws while building a reply
  (`packages/server/src/infrastructure/http-server.ts:168-180`).
- `401` `{"error":"unauthorized"}` with `WWW-Authenticate: Basic realm="waves",
charset="UTF-8"` — only when a read token is configured and the request is
  not `/healthz` (`packages/server/src/infrastructure/http-server.ts:129-138`).

### 5.2 The optional viewer token

`WAVES_READ_TOKEN_FILE` points at a file whose trimmed content is the password
(`packages/server/src/application/config.ts:13`;
`readReadToken`, `packages/server/src/infrastructure/read-token.ts:10`). It
guards everything except `/healthz`, and it is presented as HTTP Basic
credentials where **any username is accepted** — only the password is compared,
in constant time over SHA-256 digests
(`authorised`, `packages/server/src/infrastructure/http-security.ts:74-80`).
When the variable is absent the server serves the read routes to anyone.

### 5.3 Headers, and no CORS

Every response carries
`Content-Security-Policy: default-src 'none'; script-src 'self'; style-src
'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none';
frame-ancestors 'none'`, `X-Content-Type-Options: nosniff` and
`Referrer-Policy: no-referrer`, plus its own `Content-Type` and `Content-Length`
(`BASE_HEADERS` and `send`, `packages/server/src/infrastructure/http-security.ts:13`,
`37-51`). A path under `/api/` also carries `Cache-Control: no-store`
(`isApiPath`, `NO_STORE`, `packages/server/src/infrastructure/http-routes.ts:23`,
`packages/server/src/infrastructure/http-server.ts:164`).

There is **no CORS**: no `Access-Control-Allow-Origin` is ever sent, and no
`OPTIONS` preflight is answered — an `OPTIONS` request is a `405`. A browser
page on another origin therefore cannot read these routes; fetch them from a
server, not from a page.

### 5.4 Write and registration routes — planned (not yet served)

Nothing below is implemented; the read-only surface is all that answers
(`createHttpServer`, `packages/server/src/infrastructure/http-server.ts:100-105`;
`deploy/README.md:118-124` records that no write path exists yet). The shapes
are the plan's, given here so a client can be written against them:

- `PUT /api/v1/projects/<id>/waves/<wave>` with a project bearer token, body
  the envelope of section 2.
- `POST /api/v1/projects` and `DELETE /api/v1/projects/<id>` with the admin
  token.
- `DELETE /api/v1/projects/<id>/waves/<wave>`.

Planned status codes: `401` no or bad token, `403` the token is for a
different project, or the request carries an `Origin` header, `409` the id is
already taken unless the request is rotating it, `413` a body over 1 MiB, `422`
the body fails `validateEnvelope`, `429` a rate limit was hit.

## 6. TLS and trust

A client verifies the server's certificate against a pinned CA or the system
store, and nothing in a client disables that check: no `-k`, no
`--insecure`, no `rejectUnauthorized: false`, no
`NODE_TLS_REJECT_UNAUTHORIZED=0`. Get the CA out of band — from your cluster,
from a file you control — and never from the network you are about to trust
(`deploy/README.md:89-99`).

Plain `http://` is for loopback only, when you are talking to the process on the
same machine. Anything off the loopback interface is `https://`, terminated by
the proxy or ingress in front of the server; the server itself speaks plain
HTTP on its port and never asks for a client certificate
(`deploy/README.md:32-36`).

## 7. Versioning

Every envelope declares `schema: "waves/v1"` and the validator refuses
anything else (`SCHEMA`, `packages/contract/src/domain/model.ts:3`;
`packages/contract/src/domain/envelope.ts:552`).

The closed-object rule is what makes a version meaningful. Under `v1` a new
**optional** field is an additive minor change: old readers refuse to accept it
today, so a reader has to be upgraded first, and the server will only treat it
as additive once the closed key list actually gains the key. Anything else —
removing a field, renaming one, narrowing a bound, changing a type, making an
optional field required — needs `waves/v2` and a new `SCHEMA`. Planned additive
fields for a future minor revision are `prs` and `backlog`.

## 8. A curl example

Read routes only, verifying the certificate against a pinned CA. Never `-k`:

```sh
curl --fail --silent --show-error \
  --cacert ~/.config/waves/ca.crt \
  --user "viewer:$WAVES_VIEWER_TOKEN" \
  https://waves.example.com/api/v1/projects

curl --fail --silent --show-error \
  --cacert ~/.config/waves/ca.crt \
  --user "viewer:$WAVES_VIEWER_TOKEN" \
  https://waves.example.com/api/v1/projects/apollo/waves

curl --fail --silent --show-error \
  --cacert ~/.config/waves/ca.crt \
  --user "viewer:$WAVES_VIEWER_TOKEN" \
  https://waves.example.com/api/v1/projects/apollo/waves/wv6

# Health is the one route the viewer token does not guard.
curl --fail --silent --show-error \
  --cacert ~/.config/waves/ca.crt \
  https://waves.example.com/healthz
```

Read the token from a file rather than an environment variable when you can;
`WAVES_READ_TOKEN_FILE` exists for the same reason — a secret in the
environment is readable from `/proc` by any co-tenant of the host
(`packages/server/src/infrastructure/read-token.ts:3-9`).
