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
`packages/contract/src/domain/ids.ts:7`, `9`; `lane.id` uses the wave pattern.
`intervalSeconds` is required as a key but `null` is a legal value
(`readIntervalSeconds`, `packages/contract/src/domain/envelope.ts:135`).

### 2.2 A lane

Closed object; keys exactly `id`, `seat`, `reported`, `derived`,
`disagreements` (`packages/contract/src/domain/envelope.ts:51`).

| field           | type             | required | bounds                                          |
| --------------- | ---------------- | -------- | ----------------------------------------------- |
| `id`            | string           | yes      | 1 to 80 characters, `A-Za-z0-9_-`               |
| `seat`          | string           | no       | 1 to 128 characters, no control characters      |
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
the server (`createReadModel`, `packages/server/src/application/read-model.ts:119`,
`123-187`; `Now`, `…/read-model.ts:14`). `generatedAt` is stored and echoed but
no rule reads it.

In the wave view, a stale wave keeps its lane data but a lane whose
`derived.alive` is `true` is rendered as `"unknown"`, because the pusher has
stopped telling the server whether the process is still up
(`aliveView`, `…/read-model.ts:99-101`).

## 5. HTTP API

### 5.1 Read routes

A request is decided in this order, and the order is what picks the status you
see (`respond`, `packages/server/src/infrastructure/http-server.ts:171-220`):

1. A parser refusal (`431`, `408`, `400`) happens before the request exists.
2. An HTTP/1.1 `Expect` with any value other than `100-continue` is a `417`
   `{"error":"expectation failed"}`, answered before the URL is even looked at
   (section 5.4).
3. The URL length (`414`).
4. A `PUT`, `POST` or `DELETE` leaves for the write pipeline of section 5.4,
   whatever the path. The viewer token is never consulted for a write.
5. `/readyz` is answered, for the two methods it is a probe for — `GET` and
   `HEAD`, which get the same `200` or `503`. Any other method on it falls
   through to step 7 and is a `405` carrying `Allow: GET, HEAD`.
6. When a viewer token is configured, authorization (`401`), for every path
   except `/healthz` and `/readyz`.
7. The method (`405`): anything other than `GET` and `HEAD`, and any read method
   on `/api/v1/projects/<id>`, which has no read representation.
8. The route.

So with a viewer token configured an unauthenticated `OPTIONS` or `PATCH`
answers `401`, not `405` — except on `/healthz` and `/readyz`, which the token
does not guard and where it is a `405` — while an unauthenticated `POST` goes to
the write pipeline and is answered by it.

| path                                     | 200 response                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /healthz`                           | `{"ok":true}` — the process is up                                                                                                          |
| `GET /readyz`                            | `{"ok":true}` — the store can be read; otherwise `503` `{"ok":false}`                                                                      |
| `GET /api/v1/projects`                   | array of `{ id, name, repo?, registeredAt, waves, lastPush?, stale }`, see below                                                           |
| `GET /api/v1/projects/<id>/waves`        | array of `{ wave, receivedAt, intervalSeconds, lanes, stale, retained }`, `lanes` a count, newest receive first                            |
| `GET /api/v1/projects/<id>/waves/<wave>` | `{ envelope, receivedAt, stale, staleAfterMs }`, where `envelope` is the stored envelope with `lanes[].derived.alive` possibly `"unknown"` |
| `GET /` and `GET /p/<id>`                | the status page (`public/index.html`)                                                                                                      |
| `GET /<static file>`                     | a file from `public`, allow-listed extensions only                                                                                         |

In a project summary `waves` is a count, `lastPush` is the newest `receivedAt`
in the project, and `stale` is the staleness of the project's **newest** wave
by the rule of section 4; a project with no waves is not stale. The token digest
is never part of a response.

(`route`, `packages/server/src/infrastructure/http-routes.ts:93`;
`replyFor`, `readyReply`, `packages/server/src/infrastructure/http-server.ts:92-137`;
`ProjectSummary`, `WaveSummary`, `WaveView`,
`packages/server/src/application/read-model.ts:18-56`;
`SnapshotHead`, `packages/server/src/application/ports/store.ts:8-13`)

Status codes:

- `200` with the shape above.
- `404` `{"error":"not found"}` — an unknown project, an unknown wave, a path
  that is not a route, or a static file that is not there. A `project` or
  `wave` segment that fails the id pattern is not a route at all, so it is a
  `404` and never reaches the store
  (`packages/server/src/infrastructure/http-routes.ts:100-121`).
- `405` `{"error":"method not allowed"}` with the `Allow` of that path:
  `GET, HEAD, POST` on the project collection, `DELETE` on a single project,
  `GET, HEAD, PUT, DELETE` on a wave, and `GET, HEAD` everywhere else
  (`ALLOWED`, `packages/server/src/infrastructure/http-routes.ts:26-36`).
- `414` `{"error":"uri too long"}` — a request target over 2048 bytes
  (`MAX_URL_BYTES`, `packages/server/src/infrastructure/http-routes.ts:8`).
  This is checked before authentication, so an oversized target is a `414`
  even without a token.
- `431` `Request Header Fields Too Large` — a header block over 16 KiB
  (`MAX_HEADER_BYTES`, `packages/server/src/infrastructure/http-server.ts:55`).
  The request never becomes a request, so the answer is written straight to
  the socket by hand and carries no body; `408` and `400` come from the same
  place for a timed-out or otherwise unparseable request
  (`parserRefusal`, `refuseParsedRequest`,
  `packages/server/src/infrastructure/http-security.ts:146-176`).
- `500` `{"error":"internal"}` — anything that throws while building a reply
  (`packages/server/src/infrastructure/http-server.ts:233-248`).
- `401` `{"error":"unauthorized"}` with `WWW-Authenticate: Basic realm="waves",
charset="UTF-8"` — only when a read token is configured and the path is
  neither `/healthz` nor `/readyz`
  (`packages/server/src/infrastructure/http-server.ts:196-205`).

### 5.2 The optional viewer token

`WAVES_READ_TOKEN_FILE` points at a file whose trimmed content is the password
(`packages/server/src/application/config.ts:19`;
`readReadToken`, `packages/server/src/infrastructure/read-token.ts:10`). It
guards every read except `/healthz` and `/readyz`, and it is presented as HTTP
Basic credentials where **any username is accepted** — only the password is
compared, in constant time over SHA-256 digests. The scheme is exactly `Basic`
and the credentials are padded standard base64; anything else is a `401`
(`authorised`, `packages/server/src/infrastructure/http-security.ts:112-118`).
When the variable is absent the server serves the read routes to anyone. It
plays no part in a write: a project that pushes holds its project token and no
viewer token.

### 5.3 Headers, and no CORS

Every response this service writes carries
`Content-Security-Policy: default-src 'none'; script-src 'self'; style-src
'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none';
frame-ancestors 'none'`, `X-Content-Type-Options: nosniff` and
`Referrer-Policy: no-referrer`, plus its own `Content-Type` and `Content-Length`
unless it is a `204` (`BASE_HEADERS` and `send`,
`packages/server/src/infrastructure/http-security.ts:14-18`, `68-89`). A path
under `/api/`, the `GET` and `HEAD` answers of `/readyz` and every answer of the
write pipeline also carry
`Cache-Control: no-store` (`isApiPath`,
`packages/server/src/infrastructure/http-routes.ts:83`; `extraFor`,
`packages/server/src/infrastructure/http-server.ts:148-150`, `186-194`;
`answer`, `packages/server/src/infrastructure/http-write.ts:255-265`). The `405`
on `/readyz` carries no `Cache-Control`.

There is **no CORS**: no `Access-Control-Allow-Origin` is ever sent, no
`OPTIONS` preflight is answered — an `OPTIONS` request is a `405`, or a `401`
behind a viewer token, with the two probe paths as the only exception: the
viewer token does not guard them, so an `OPTIONS` on `/healthz` or `/readyz` is
always a `405` (section 5.1) — and a write that carries an `Origin` header is
refused (section 5.4). A browser page on another origin therefore can neither
read these routes nor write to them; call them from a server, not from a page.

### 5.4 Write and registration routes

| route                                       | token   | body                             | success                                        |
| ------------------------------------------- | ------- | -------------------------------- | ---------------------------------------------- |
| `PUT /api/v1/projects/<id>/waves/<wave>`    | project | the envelope of section 2        | `200` `{ receivedAt }`                         |
| `DELETE /api/v1/projects/<id>/waves/<wave>` | project | none                             | `204`, or `404` when there was no such wave    |
| `POST /api/v1/projects`                     | admin   | `{ id, name, repo? }`, see below | `201` `{ id, token }`                          |
| `DELETE /api/v1/projects/<id>`              | admin   | none                             | `204`, or `404` when there was no such project |

(`writeRouteOf`, `packages/server/src/infrastructure/http-routes.ts:59-76`;
`createWriteHandler`, `packages/server/src/infrastructure/http-write.ts:244`)

A token is presented as `Authorization: Bearer <token>`: exactly that scheme,
exactly one space, and 32 to 128 characters of `A-Z`, `a-z`, `0-9`, `_` and `-`
(`bearerToken`, `TOKEN_PATTERN`,
`packages/server/src/application/bearer.ts:10-36`). The server keeps only the
SHA-256 digest of a project token, and compares digests in constant time
(`digestsEqual`, `packages/server/src/infrastructure/digest.ts:11`).

The admin token is one secret for the whole service, read once at startup from
the file `WAVES_ADMIN_TOKEN_FILE` names. When that variable is absent, or
names a file that does not exist, the two admin routes do not exist: they answer
`404`, so a probe cannot tell a disabled route from a path that was never there.
A file that does exist must hold a token in the grammar above once trimmed, or
the server refuses to start
(`readAdminToken`, `packages/server/src/infrastructure/admin-token.ts:21-40`;
`packages/server/src/infrastructure/http-write.ts:457-466`).

**Registration.** The body is a closed object of `id` (the project id pattern of
section 2.1), `name` (1 to 80 characters) and an optional `repo` (an `https` URL
of at most 200 characters); any other key is a `422`. The `201` carries the
project's token — 32 random bytes as base64url, 43 characters — and that answer
is the only time the token exists in clear text anywhere. An id that is already
registered is a `409`, unless the request target is exactly
`POST /api/v1/projects?rotate=1`, which mints a new token for it, invalidates
the old one and keeps its `registeredAt`. A rotation body is a full
registration body: its `name` and `repo` replace the stored ones. `rotate=1` on an id that is not
registered registers it. Deleting a project removes its waves with it.
(`REGISTRATION_KEYS`, `registerProject`,
`packages/server/src/application/write-model.ts:16`, `97-128`;
`packages/contract/src/domain/project.ts:16-21`;
`mintToken`, `packages/server/src/infrastructure/digest.ts:19`;
`deleteProject`, `packages/server/src/infrastructure/file-store.ts:116-129`)

**Authentication comes before the body.** Every step below is decided from the
request line, the headers and — for the two `429`s — what the server remembers
of earlier failures and writes, never from the body. They run in this order, and each refusal closes the
connection without reading the body
(`packages/server/src/infrastructure/http-write.ts:436-527`):

1. `404` `{"error":"not found"}` — the path is not a route. `405` with that
   path's `Allow` — it is one, and this method does not write to it.
2. `404` — an admin route with no admin token configured.
3. `400` `{"error":"bad query"}` — any non-empty query string, other than
   exactly `rotate=1` on a registration.
4. `403` `{"error":"cross-origin writes refused"}` — the request carries an
   `Origin` header.
5. Framing. A `DELETE` that declares a body is `400`
   `{"error":"a delete carries no body"}`. A `PUT` or `POST` whose
   `Content-Type` is not `application/json` — a `charset` parameter, if
   present, must be `utf-8` — is `415` `{"error":"unsupported media type"}`,
   and one whose `Content-Length` is over the cap is `413`
   `{"error":"body too large"}`. The cap is 1 MiB = 1 048 576 bytes for a
   `PUT` and 16 KiB = 16 384 bytes for a `POST` (`PUT_BODY_CAP`,
   `POST_BODY_CAP`, `packages/server/src/infrastructure/http-write.ts:41-42`).
6. `429` `{"error":"too many failures"}` — this client address has failed
   authentication 10 times within 60 seconds. The window starts at the first
   failure and is not extended by the ones inside it (`FAILURE_LIMIT`,
   `FAILURE_WINDOW_MS`, `packages/server/src/application/limiters.ts:3-4`).
7. Authentication. More than one `Authorization` header is `400`
   `{"error":"more than one authorization"}`. Behind a trusted proxy
   (`WAVES_TRUST_PROXY=1`), a write whose `X-Forwarded-Proto` is not `https` is
   `403` `{"error":"https required"}`. No token, a token outside the grammar
   above, or one that matches nothing is `401` `{"error":"unauthorized"}` with
   `WWW-Authenticate: Bearer realm="waves"`. A valid token of a **different**
   project is `403` `{"error":"wrong project"}`; every stored digest is
   compared, so the time an answer takes says nothing about which projects
   exist. Each `401` and `403` of this step counts as one failure against the
   address in step 6
   (`digestOf`, `authenticateWave`, `denied`,
   `packages/server/src/infrastructure/http-write.ts:268-344`).
8. `429` `{"error":"too many writes"}` with `Retry-After: 1` — one write per
   second per project, counting every authenticated attempt and not only the
   accepted ones. The two admin routes share one allowance between them
   (`PROJECT_INTERVAL_MS`, `packages/server/src/application/limiters.ts:5`;
   `ADMIN_LIMITER_KEY`, `packages/server/src/infrastructure/http-write.ts:43`).

The client address in step 6 is the socket's, or with `WAVES_TRUST_PROXY=1` the
last entry of `X-Forwarded-For`
(`clientAddress`, `packages/server/src/infrastructure/client-address.ts:54-63`).

Only then is the body read. A client that sent `Expect: 100-continue` over
HTTP/1.1 gets its `100 Continue` here and not before, so a client that waits for
it never sends a body to a refusal; a client that does not wait and is refused
sees the connection reset mid-body (`continueIfExpected`,
`packages/server/src/infrastructure/http-write.ts:233-242`; `SendOptions`,
`packages/server/src/infrastructure/http-security.ts:47-66`).

An `Expect` header with any other value never reaches this pipeline: the service
answers it itself, before any route, any authorization and even before the URL
length is looked at, with `417` `{"error":"expectation failed"}`, the headers of
section 5.3 and — on a path under `/api/` — `Cache-Control: no-store`. The
connection is closed rather than left for a body nobody will read, and the
answer is logged like any other (`checkExpectation`,
`packages/server/src/infrastructure/http-server.ts:295-305`).

After the body:

- `413` `{"error":"body too large"}` — the bytes that arrived went over the cap
  whatever the declared length said, chunked transfer included. The read stops
  at the cap and the connection is closed.
- `400` `{"error":"not utf-8"}` or `{"error":"bad json"}`.
- `422` `{"errors":[{ path, message }]}` — the body fails `validateEnvelope`
  (or, for a registration, the rules above); the issues are those of section 3.
  An envelope whose `project` or `wave` differs from the path is a `422` with
  the single issue `/project`, `expected the project and wave the path names`.
- `409` `{"error":"already registered"}` — a registration only.
- `200` `{"receivedAt":"…"}` for a push: the server's own clock at the moment it
  stored the snapshot, which is the instant every rule of section 4 reads. A
  push replaces the wave's previous snapshot; the server keeps one per wave.

(`readBody`, `register`, `push`,
`packages/server/src/infrastructure/http-write.ts:281-428`;
`putWave`, `packages/server/src/application/write-model.ts:71-81`)

## 6. TLS and trust

A client verifies the server's certificate against a pinned CA or the system
store, and nothing in a client disables that check: no `-k`, no
`--insecure`, no `rejectUnauthorized: false`, no
`NODE_TLS_REJECT_UNAUTHORIZED=0`. Get the CA out of band — from your cluster,
from a file you control — and never from the network you are about to trust
(`deploy/README.md:120-130`).

Plain `http://` is for loopback only, when you are talking to the process on the
same machine. Anything off the loopback interface is `https://`, terminated by
the proxy or ingress in front of the server; the server itself speaks plain
HTTP on its port and never asks for a client certificate
(`deploy/README.md:35-39`).

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

The read routes, verifying the certificate against a pinned CA. Never `-k`. To
write, use the client in `packages/client`, which keeps the project token in a
0600 file and off the command line:

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

# Health and readiness are the two routes the viewer token does not guard.
curl --fail --silent --show-error \
  --cacert ~/.config/waves/ca.crt \
  https://waves.example.com/healthz
```

Read the token from a file rather than an environment variable when you can;
`WAVES_READ_TOKEN_FILE` exists for the same reason — a secret in the
environment is readable from `/proc/<pid>/environ` by anything that passes the
kernel's ptrace access check on the process (the same user, or root), and it is
inherited by every child process
(`packages/server/src/infrastructure/read-token.ts:5-9`).
