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
(`readIntervalSeconds`, `packages/contract/src/domain/fields.ts:28`).

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
(`packages/contract/src/domain/envelope.ts:51-67`, `201-389`)

### 2.3 Count caps

- `lanes` at most 200 (`MAX_LANES`, `packages/contract/src/domain/envelope.ts:69`).
- `disagreements` at most 20 per lane (`MAX_DISAGREEMENTS`, `…/envelope.ts:74`).
- `detail` at most 256 keys in total, nested (`MAX_DETAIL_KEYS`, `…/envelope.ts:77`).
- `detail` at most 8 levels deep, counting the `detail` object itself as level 1
  (`MAX_DETAIL_DEPTH`, `…/envelope.ts:76`).

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
  (`MAX_DETAIL_BYTES`, `packages/contract/src/domain/envelope.ts:71`).
- `derived.log.tail` must be at most 4 KiB = 4096 bytes, measured as bytes and
  not characters (`MAX_TAIL_BYTES`, `…/envelope.ts:72`).
- Any character below `0x20`, and `0x7f`, is a control character and is refused
  in every string the validator reads — keys of `detail` included, where the
  message is `a key contains a control character`. Tab and newline survive only
  where the rule allows line breaks: `log.tail` and `detail` string values.
  (`packages/contract/src/domain/validation.ts:58-81`, `…/envelope.ts:152-154`)
- The keys `__proto__`, `constructor` and `prototype` are refused anywhere
  inside `detail`, at any depth (`FORBIDDEN_DETAIL_KEYS`,
  `packages/contract/src/domain/envelope.ts:79`).
- `detail` may hold any JSON value — strings, numbers, booleans, `null`,
  arrays, objects. The only rules on it are the byte cap, the depth cap, the key
  budget, the control-character rule and the reserved keys.
  (`detailProblem`, `packages/contract/src/domain/envelope.ts:125-199`)

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

## The project status document

A project may also push what it knows about **itself**: how many pull-request rows
a listing could not read, and what its last `plan:verify` artifact said. Both are
facts about a project at a moment, not about a wave, so they live in a second
document with its own schema, `waves-status/v1`, and its own validator
`validateStatus` — the same shape as the envelope's gate, pure, and exported from
the package. The wave envelope does not carry either key.
(`packages/contract/src/domain/status.ts`, `packages/contract/src/index.ts`)

| field             | type              | required | bounds                                                        |
| ----------------- | ----------------- | -------- | ------------------------------------------------------------- |
| `schema`          | string            | yes      | exactly `"waves-status/v1"` (`STATUS_SCHEMA`, `…/model.ts:5`) |
| `project`         | string            | yes      | the project id of section 2.1                                 |
| `generatedAt`     | string            | yes      | strict ISO-8601 UTC, see 2.5                                  |
| `intervalSeconds` | integer or `null` | yes      | 1 to 300 inclusive, or `null` for the 300 s default           |
| `prs`             | object            | no       | `{ skipped }`, see below                                      |
| `backlog`         | object            | no       | see below                                                     |

Closed at every level, exactly as the envelope is: an unknown key anywhere is an
error (`STATUS_KEYS`, `packages/contract/src/domain/status.ts:17`).

`intervalSeconds` is not in the shape the plan sketched. It is here because
staleness applies to a project status as it applies to a wave (section 4), and
that needs an interval; it is the same reader the envelope uses
(`readIntervalSeconds`, `packages/contract/src/domain/fields.ts:28`).

**A document with neither `prs` nor `backlog` is valid.** It says "nothing to
report" and still refreshes the status's freshness, which is how a project says
it is alive and has no news.

`prs` is closed, keys exactly `skipped`: the rows a pull-request listing returned
that no parser could read. One listing per collection, so it is one number for
the run, an integer in 0 to 100 000 (`MAX_SKIPPED`,
`packages/contract/src/domain/status.ts:28`).

`backlog` is closed, keys exactly `state`, `at`, `scope`, `git`, `premises`
(`BACKLOG_KEYS`, `packages/contract/src/domain/status-backlog.ts:20`):

| field      | type   | required | bounds                              |
| ---------- | ------ | -------- | ----------------------------------- |
| `state`    | string | yes      | `recorded` \| `absent` \| `unknown` |
| `at`       | string | no       | strict ISO-8601 UTC, see 2.5        |
| `scope`    | object | no       | `{ kind, plans }`, see below        |
| `git`      | object | no       | `{ branch, head }`, see below       |
| `premises` | array  | no       | at most 200 entries, see below      |

`scope` is closed: `kind` is `full` | `partial`, and `plans` is at most
64 entries of 1 to 120 characters (`MAX_PLANS`, `MAX_PLAN_CHARS`,
`packages/contract/src/domain/status-backlog.ts:39-40`). `git` is closed:
`branch` is 1 to 255 characters — git's own limit for a ref component is wider,
255 is what a page can show — and `head` matches `^[0-9a-f]{7,64}$`, so a full
or abbreviated object id and nothing else (`MAX_BRANCH_CHARS`, `HEAD_PATTERN`,
`packages/contract/src/domain/status-backlog.ts:42`, `48`).

`premises` is closed, keys exactly `lane`, `plan`, `status`, `reason`. `lane`
and `plan` are 1 to 120 characters, `status` is `holds` | `stale` | `timed-out` |
`error`, and `reason` is an optional 1 to 500 characters. At most 200 entries
(`MAX_PREMISES`, `MAX_PREMISE_CHARS`, `MAX_REASON_CHARS`,
`packages/contract/src/domain/status-backlog.ts:44-46`).

Every string of the document is bounded in characters and free of control
characters, and none of them allows a line break: there is no field here that
holds log output, so no rule sets `lineBreaks`. The whole document re-serialised
must be at most 1 MiB, else one error at the root, as for the envelope
(`normalise`, `packages/contract/src/domain/status.ts:88`).

**Staleness.** The clock is the server's and the instant it uses is when the
server received the document, exactly as section 4 for a wave: the status is
stale when the time since its receive is longer than
`staleAfterMs(intervalSeconds)`, with the same `null` default of 300 s.
`generatedAt` is stored and echoed, and no rule reads it.

A minimal valid status document, carrying neither key:

```json
{
  "schema": "waves-status/v1",
  "project": "apollo",
  "generatedAt": "2026-10-03T08:00:00Z",
  "intervalSeconds": null
}
```

A full valid status document:

```json
{
  "schema": "waves-status/v1",
  "project": "apollo",
  "generatedAt": "2026-10-03T08:00:00.250Z",
  "intervalSeconds": 300,
  "prs": { "skipped": 2 },
  "backlog": {
    "state": "recorded",
    "at": "2026-10-03T07:55:00Z",
    "scope": { "kind": "full", "plans": ["plan:verify"] },
    "git": {
      "branch": "main",
      "head": "0a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"
    },
    "premises": [
      { "lane": "C1", "plan": "plan:verify", "status": "holds" },
      {
        "lane": "C2",
        "plan": "plan:verify",
        "status": "timed-out",
        "reason": "no push since 06:00"
      }
    ]
  }
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
the server (`createReadModel`, `packages/server/src/application/read-model.ts:480`,
`564-779`; `Now`, `…/read-model.ts:25`). `generatedAt` is stored and echoed but
no rule reads it.

In the wave view, a stale wave keeps its lane data but a lane whose
`derived.alive` is `true` is rendered as `"unknown"`, because the pusher has
stopped telling the server whether the process is still up
(`aliveView`, `…/read-model.ts:243-245`).

## 5. HTTP API

### 5.1 Read routes

A request is decided in this order, and the order is what picks the status you
see (`respond`, `packages/server/src/infrastructure/http-server.ts:182-258`):

1. A parser refusal (`431`, `408`, `400`) happens before the request exists.
2. An HTTP/1.1 `Expect` with any value other than `100-continue` is a `417`
   `{"error":"expectation failed"}`, answered before the URL length is looked at
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
8. The query string (`400` `{"error":"bad query"}`), on
   `/api/v1/projects/<id>/lanes` alone and by the rule of section 5.1.1. Every
   other read route ignores its query.
9. The route.

So with a viewer token configured an unauthenticated `OPTIONS` or `PATCH`
answers `401`, not `405` — except on `/healthz` and `/readyz`, which the token
does not guard and where it is a `405` — while an unauthenticated `POST` goes to
the write pipeline and is answered by it. Because the query is step 8, an
unauthenticated request to the lanes route with a bad query is a `401` and a
`PATCH` with a bad query is a `405`, both before the query is looked at.

| path                                              | 200 response                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /healthz`                                    | `{"ok":true}` — the process is up                                                                                                          |
| `GET /readyz`                                     | `{"ok":true}` — the store can be read; otherwise `503` `{"ok":false}`                                                                      |
| `GET /api/v1/projects`                            | array of `{ id, name, repo?, registeredAt, waves, lanes, lastPush?, stale }`, see below                                                    |
| `GET /api/v1/projects/<id>/waves`                 | array of `{ wave, receivedAt, intervalSeconds, lanes, stale, retained }`, `lanes` a count, newest receive first                            |
| `GET /api/v1/projects/<id>/lanes`                 | `{ project: { id, name, repo? }, waves: [...], lanes: [...], truncated }`, see 5.1.1                                                       |
| `GET /api/v1/projects/<id>/waves/<wave>`          | `{ envelope, receivedAt, stale, staleAfterMs }`, where `envelope` is the stored envelope with `lanes[].derived.alive` possibly `"unknown"` |
| `GET /api/v1/attention`                           | `{ lanes: [{ project, wave, lane, seat?, reasons, receivedAt, stale, pr? }], projects: [{ id, attention }], truncated }`, see below        |
| `GET /`, `GET /p/<id>` and `GET /p/<id>/w/<wave>` | the status page (`public/index.html`)                                                                                                      |
| `GET /<static file>`                              | a file from `public`, allow-listed extensions only                                                                                         |

In a project summary `waves` is a count, `lanes` is the number of lanes in the
project's **retained** waves summed from the wave heads the route already reads,
`lastPush` is the newest `receivedAt` in the project, and `stale` is the
staleness of the project's **newest** wave by the rule of section 4; a project
with no waves is not stale and has no lanes. The token digest is never part of a
response.

`GET /api/v1/attention` is the same view across every registered project. A lane
is listed when it holds at least one of six reasons, and the reasons always come
back in this order:

| reason         | holds when                                                                   |
| -------------- | ---------------------------------------------------------------------------- |
| `failed`       | `reported.event` is `"failed"`                                               |
| `disagreement` | `disagreements` is not empty                                                 |
| `checks`       | `derived.pr.checks` is `"fail"`                                              |
| `gate`         | `derived.gate.exit` is a number other than `0`                               |
| `exit`         | `derived.alive` is `false` and `derived.exit` is a number other than `0`     |
| `silent`       | the wave is stale, `derived.alive` is `true` and `derived.exit` is not there |

A lane whose `derived.pr.state` is `merged` or `closed` holds none of them,
whatever else it is carrying (`attentionReasons`,
`packages/server/src/domain/attention.ts:40-72`). Only the waves the server
received in the last 72 hours take part, counted on the receive time as
`nowMs - Date.parse(receivedAt) <= 72 * 60 * 60 * 1000` (`inAttentionWindow`,
`ATTENTION_WINDOW_MS`, `…/domain/attention.ts:75-80`, `21`). The lanes are
ordered by receive time descending and cut at 200 (`MAX_ATTENTION_LANES`,
`…/domain/attention.ts:24`); the sort is stable, so lanes received within the
same millisecond keep the order they were found in, and `truncated` says whether
that cut anything. `projects` carries one entry per registered project, in the
order the registry answers it, and `attention` counts that project's lanes
**before** the cut — a project whose lanes the cap left out still says how many
it wanted. The route reads the wave heads of every project and then the lanes of
the waves still inside the window, through the same cache the project listing
uses, and never `listSnapshots`: a fleet of projects is answered from one wave
each. A wave's staleness here is read from the snapshot it answered with — its
own receive time and its own interval — so a push that lands between the heads and
the snapshot is judged by the push (`listAttention`,
`packages/server/src/application/read-model.ts:693-755`).

(`route`, `packages/server/src/infrastructure/http-routes.ts:116`;
`replyFor`, `readyReply`, `packages/server/src/infrastructure/http-server.ts:98-145`;
`ProjectSummary`, `WaveSummary`, `WaveView`,
`packages/server/src/application/read-model.ts:69-113`;
`SnapshotHead`, `packages/server/src/application/ports/store.ts:8-13`)

#### 5.1.1 `GET /api/v1/projects/<id>/lanes`

Every lane of one project, so that a page which shows a project's lanes across
its waves needs no request per wave:

```
{ project: { id, name, repo? },
  waves:  [ { wave, receivedAt, intervalSeconds, lanes, stale, retained } ],
  lanes:  [ { wave, id, seat?,
              reported?: { stage, event, ts, pr?, round? },
              derived: { alive, exit?, gate?, pr?, diff?, planReview?, risk?,
                         log?: { bytes, mtimeMs, tail } },
              disagreements, disagreement?, reasons } ],
  truncated }
```

`waves` is exactly what `GET /api/v1/projects/<id>/waves` answers, in the same
order, so the wave strip beside the table needs no second request. `lanes` holds
the rows of the waves this request covers, newest wave first and each wave's own
order within it, and a row's `wave` names the wave it came from.

**What a row never carries.** `reported.detail`; the text of
`derived.log.tail`, which is sent as a boolean that says whether a tail was
pushed; and every disagreement after the first, of which only `disagreements` (the
count) and `disagreement` (the first) are sent. Those three are the heaviest
fields of an envelope and the wave detail route has all of them. `derived.alive`
is `"unknown"` for a lane whose `derived.alive` is `true` when its wave is
stale, by the rule of section 4 — as in the wave view — and `reasons` is the
lane's attention reasons (section 5.1) for the staleness of its wave, decided per
request. Every optional key is **absent** when the stored lane has none, never
present holding nothing: `project.repo`, `seat`, `reported`, `reported.pr`,
`reported.round`, every optional key of `derived` and `disagreement` all obey
this.

**Scope.** By default only the project's **retained** waves are listed
(section 4); a wave past the retention is still in `waves`, with
`retained: false`, and contributes no rows. `?all=1` lists every wave the store
holds.

**The query.** The part of the target after the first `?` must be empty — no `?`
at all, or a bare trailing `?` — or exactly `all=1`. Anything else is a `400`
`{"error":"bad query"}` with the same headers as any other API answer, including
`Cache-Control: no-store`. This is the **only** read route that reads its query
string: every other one ignores it, and the access log keeps logging the path
alone. The check is step 8 of section 5.1, so an unauthenticated request with a
bad query is a `401`, a `PATCH` with a bad query is a `405`, and a bad query on
an unknown project is a `400` rather than a `404`. `HEAD` gets the same status as
`GET` with no body (`queryOf`, `…/http-routes.ts:93-96`; `ALL_WAVES` and the
check itself, `packages/server/src/infrastructure/http-server.ts:61`, `223-249`).

**The bounds and `truncated`.** A listing stops at whichever of three bounds it
reaches first, and no further wave is read once one of them is spent — the wave
heads carry the lane counts, so a wave that has lanes is known to hold rows that
are not listed without reading it:

- at most 2 000 rows (`MAX_PROJECT_LANES`);
- at most about 2 MiB of rows (`MAX_PROJECT_LANES_BYTES`, 2 097 152 bytes) — a
  row's cost is the JSON of the row itself plus 256 bytes
  (`ROW_OVERHEAD_BYTES`) for the wave id, the reasons and the `alive` value the
  request settles. The first row is always answered, whatever it costs;
- at most 200 waves read per request (`MAX_WAVES_PER_READ`), which is what
  `all = true` is bounded by: nothing deletes a wave past the retention, so a
  project that has pushed one wave every ten minutes for a year holds thousands.
  A wave whose head says it holds no lanes is never read at all.

`truncated` is `true` when at least one matching row was not collected, whether
it was left in the wave a bound was spent in or in any later wave the heads say
has lanes (`MAX_PROJECT_LANES`, `MAX_PROJECT_LANES_BYTES`,
`ROW_OVERHEAD_BYTES`, `MAX_WAVES_PER_READ`,
`packages/server/src/application/read-model.ts:30`, `41`, `48`, `57`; `listLanes`,
`…/read-model.ts:611-684`).

**Cost and size.** The route reads the project's wave heads and then the full
snapshot of each wave it lists, and never `listSnapshots`. The read model keeps
each wave's computed rows in a map keyed by project and wave, and an entry is a
hit while the wave's head still describes the wave it was built from — the same
`receivedAt` **and** the same number of lanes, so a push inside one millisecond
is not mistaken for the wave that is already there. Reading a wave is a use of
it, so an entry that is answered moves to the newest position. The map holds at
most 512 waves and at most 10 000 rows, dropping the entry used longest ago while
either is exceeded; the row count is what bounds memory. A poll that finds nothing
new therefore parses nothing while the waves it polls fit in the map, and a poll
of more than 512 waves reads the ones it did not hold. Nothing time-dependent is
kept, so the staleness of a wave is resolved per request and never cached.

**Why the bound is in bytes.** The contract's caps on `seat`, `planReview`,
`risk` and every disagreement are in **characters**, and it refuses only control
characters, so a lane of non-ASCII text at the cap is several times larger in
bytes than a lane of ASCII at the same length: a `"` is two bytes once JSON has
escaped it, a CJK ideograph is three, and a lone surrogate — which is not a
control character — is six, written as `\udXXX`. Measured on the 2 000-lane cap
with every string of a lane at its cap, the same lane answers in 4.8 MB filled
with `"`, 6.5 MB filled with `中` and 11.4 MB filled with a lone surrogate; the
byte bound answers 832, 627 and 360 rows of the 2 000 instead, in about 2.0 MB
each. Each row's cost is measured once, when its cache entry is built, by
`utf8Length` over the row's own JSON (`utf8Length`, `opensPairAt`,
`packages/server/src/application/read-model.ts:343-383`; the cache bounds,
`MAX_CACHED_WAVES`, `MAX_CACHED_ROWS`, `remember`, `cachedWave`,
`…/read-model.ts:66-67`, `511-561`).

`404` `{"error":"not found"}` for an unknown project, as on the other project
routes, and `405` with `Allow: GET, HEAD` for any other method.

Status codes:

- `200` with the shape above.
- `404` `{"error":"not found"}` — an unknown project, an unknown wave, a path
  that is not a route, or a static file that is not there. A `project` or
  `wave` segment that fails the id pattern is not a route at all, so it is a
  `404` and never reaches the store
  (`packages/server/src/infrastructure/http-routes.ts:126-150`).
- `405` `{"error":"method not allowed"}` with the `Allow` of that path:
  `GET, HEAD, POST` on the project collection, `DELETE` on a single project,
  `GET, HEAD, PUT, DELETE` on a wave, and `GET, HEAD` everywhere else —
  `/api/v1/attention` and `/api/v1/projects/<id>/lanes` among that last group
  (`ALLOWED`, `packages/server/src/infrastructure/http-routes.ts:29-41`).
- `400` `{"error":"bad query"}` — only on `/api/v1/projects/<id>/lanes`, and only
  for a query string that is neither empty nor exactly `all=1` (section 5.1.1).
  It is answered after the token and the method, and it carries `no-store` like
  every other API answer.
- `414` `{"error":"uri too long"}` — a request target over 2048 bytes
  (`MAX_URL_BYTES`, `packages/server/src/infrastructure/http-routes.ts:9`).
  This is checked before authentication, so an oversized target is a `414`
  even without a token.
- `431` `Request Header Fields Too Large` — a header block over 16 KiB
  (`MAX_HEADER_BYTES`, `packages/server/src/infrastructure/http-server.ts:56`).
  The request never becomes a request, so the answer is written straight to the
  socket by hand and carries no body; `408` and `400` come from the same
  place for a timed-out or otherwise unparseable request
  (`parserRefusal`, `refuseParsedRequest`,
  `packages/server/src/infrastructure/http-security.ts:146-176`).
- `500` `{"error":"internal"}` — anything that throws while building a reply
  (`packages/server/src/infrastructure/http-server.ts:260-288`).
- `401` `{"error":"unauthorized"}` with `WWW-Authenticate: Basic realm="waves",
charset="UTF-8"` — only when a read token is configured and the path is
  neither `/healthz` nor `/readyz`
  (`packages/server/src/infrastructure/http-server.ts:207-216`).

### 5.2 The optional viewer token

`WAVES_READ_TOKEN_FILE` points at a file whose trimmed content is the password
(`packages/server/src/application/config.ts:20`;
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
`packages/server/src/infrastructure/http-routes.ts:105`; `extraFor`,
`packages/server/src/infrastructure/http-server.ts:157-159`, `195-204`;
`answer`, `packages/server/src/infrastructure/http-write.ts:273-283`). The `405`
that an `OPTIONS` or `PATCH` gets on `/readyz` carries no `Cache-Control`; a
`PUT`, `POST` or `DELETE` on it is the write pipeline's `405` and does.

There is **no CORS**: no `Access-Control-Allow-Origin` is ever sent, no
`OPTIONS` preflight is answered — an `OPTIONS` request is a `405`, or a `401`
behind a viewer token, with the two probe paths as the only exception: the
viewer token does not guard them, so an `OPTIONS` on `/healthz` or `/readyz` is
always a `405` (section 5.1) — and a write that carries an `Origin` header is
refused (section 5.4). A browser page on another origin therefore can neither
read these routes nor write to them; call them from a server, not from a page.

### 5.4 Write and registration routes

| route                                       | token                             | body                             | success                                        |
| ------------------------------------------- | --------------------------------- | -------------------------------- | ---------------------------------------------- |
| `PUT /api/v1/projects/<id>/waves/<wave>`    | project                           | the envelope of section 2        | `200` `{ receivedAt }`                         |
| `DELETE /api/v1/projects/<id>/waves/<wave>` | project                           | none                             | `204`, or `404` when there was no such wave    |
| `POST /api/v1/projects`                     | admin, or enrollment for a new id | `{ id, name, repo? }`, see below | `201` `{ id, token }`                          |
| `DELETE /api/v1/projects/<id>`              | admin                             | none                             | `204`, or `404` when there was no such project |

(`writeRouteOf`, `packages/server/src/infrastructure/http-routes.ts:71-88`;
`createWriteHandler`, `packages/server/src/infrastructure/http-write.ts:259`)

A token is presented as `Authorization: Bearer <token>`: exactly that scheme,
exactly one space, and 32 to 128 characters of `A-Z`, `a-z`, `0-9`, `_` and `-`
(`bearerToken`, `TOKEN_PATTERN`,
`packages/server/src/application/bearer.ts:10-36`). The server keeps only the
SHA-256 digest of a project token, and compares digests in constant time
(`digestsEqual`, `packages/server/src/infrastructure/digest.ts:11`).

The admin token is one secret for the whole service, read once at startup from
the file `WAVES_ADMIN_TOKEN_FILE` names. When that variable is absent, or
names a file that does not exist, `?rotate=1` and `DELETE` do not exist: they
answer `404`, so a probe cannot tell a disabled route from a path that was never
there. A plain `POST /api/v1/projects` answers `404` only when neither the admin
token nor the enrollment token is configured.
A file that does exist must hold a token in the grammar above once trimmed, or
the server refuses to start
(`readAdminToken`, `packages/server/src/infrastructure/admin-token.ts:59-61`;
`adminRouteEnabled`, `packages/server/src/application/enrollment.ts:69-79`;
`packages/server/src/infrastructure/http-write.ts:517-537`).

The **enrollment token** is a second, optional secret, read the same way from
the file `WAVES_ENROLL_TOKEN_FILE` names, with the same value rule
(`readEnrollToken`, `packages/server/src/infrastructure/admin-token.ts:68-70`).
It may do exactly one thing: `POST /api/v1/projects` with no query, for an id
that does not exist yet. Everything else is refused: `?rotate=1` and
`DELETE /api/v1/projects/<id>` under it are `403`
`{"error":"enrollment token cannot do this"}`, charged to the address's failure
window like a `401`; a push or a wave delete under it is `401`, as it is for any
token that is not a project's. It never rotates a token, never removes a project
and never touches a wave
(`authorize`, `packages/server/src/application/enrollment.ts:37-52`;
`refused`, `packages/server/src/infrastructure/http-write.ts:361-367`).

When both tokens are present and their files hold the same value the server
**refuses to start** with exit `2`, because an enrollment copy of the admin token
would carry every admin power to wherever that copy lives. The comparison is over
SHA-256 digests through `timingSafeEqual` and never over the values themselves
(`sameToken`, `packages/server/src/infrastructure/admin-token.ts:79-81`;
`packages/server/src/main.ts`).

The whole authorization table is one pure function, and a route that no
configured token could ever authorize is `404` rather than locked:

| route         | rotate | token  | answer       | route exists when   |
| ------------- | ------ | ------ | ------------ | ------------------- |
| any           | any    | none   | refuse `401` | —                   |
| register      | no     | admin  | `admin`      | `admin \|\| enroll` |
| register      | no     | enroll | `enroll`     | `admin \|\| enroll` |
| register      | yes    | admin  | `admin`      | `admin`             |
| register      | yes    | enroll | refuse `403` | `admin`             |
| removeProject | any    | admin  | `admin`      | `admin`             |
| removeProject | any    | enroll | refuse `403` | `admin`             |

(`authorize` and `adminRouteEnabled`,
`packages/server/src/application/enrollment.ts:37-79`; `kindOf`,
`packages/server/src/infrastructure/http-write.ts:346-352`)

A registration or a removal therefore compares the presented digest against
**both** configured digests, in two statements with no early return, so the time
an answer takes depends on which tokens are configured and never on what was
presented. The project-write path is not changed by any of this: a push or a
wave delete compares only against every stored project digest.

With only the enrollment token configured and no admin token, `POST
/api/v1/projects` without a token is `401` while `?rotate=1` is `404` and another
query is `400`, so a probe can tell a route that is locked from one that is gone,
and from one whose query it does not know — never the value of a token, nor which
token anyone presented. That is the cost of the `404` rule and it is accepted.

**Registration.** The body is a closed object of `id` (the project id pattern of
section 2.1), `name` (1 to 80 characters) and an optional `repo` (an `https` URL
of at most 200 characters); any other key is a `422`. A `repo` is refused unless
every character in it is one a URL holds unescaped —
`A-Z a-z 0-9 - . _ ~ : / ? # [ ] @ ! $ & ' ( ) * + , ; = %` — so a placeholder
such as `https://github.com/<owner>/<repo>` is a `422` rather than a stored URL
(`REPO_CHARACTER_PATTERN`, `packages/contract/src/domain/project.ts:34`,
`53`; the
message is `expected only the characters a URL holds unescaped`). A bare `%` is
in the set, so `b%ZZ` and a trailing `%` are the character rule's business and
the `https` rule's after it; an internationalised host is refused, because its
letters are not in the set. The `201` carries the
project's token — 32 random bytes as base64url, 43 characters — and that answer
is the only time the token exists in clear text anywhere. An id that is already
registered is a `409`, unless the request target is exactly
`POST /api/v1/projects?rotate=1`, which mints a new token for it, invalidates
the old one and keeps its `registeredAt`. A rotation body is a full
registration body: its `name` and `repo` replace the stored ones. `rotate=1` on an id that is not
registered registers it. Deleting a project removes its waves with it.
(`REGISTRATION_KEYS`, `registerProject`,
`packages/server/src/application/write-model.ts:16`, `152-177`;
`packages/contract/src/domain/project.ts:16-21`;
`mintToken`, `packages/server/src/infrastructure/digest.ts:19`;
`deleteProject`, `packages/server/src/infrastructure/file-store.ts:149-162`)

Under the enrollment token a registration is one serialized store operation that
answers `created`, `exists` or `ceiling`, so two concurrent enrollments of one
id cannot both win and two at the ceiling cannot both pass. Past **64 projects in
the registry** — counting every project however it was registered — an enrollment
answers `403` `{"error":"enrollment ceiling reached"}`, which is _not_ charged to
the failure window, and the admin token still registers. The ceiling is a
constant rather than configuration, and it bounds how many, never what is in it
(`ENROLL_CEILING`, `packages/server/src/application/write-model.ts:43`;
`enrollProject`, `packages/server/src/application/write-model.ts:186-199`;
`createProject`, `packages/server/src/application/ports/store.ts:30-41`;
`FileStore.createProject`, `packages/server/src/infrastructure/file-store.ts:126-147`).

Every registration logs one line through the same `log` as the access log when
the enrollment token made it: `{"ts":"…","event":"enrolled","project":"<id>"}`,
naming the id and never a token or a digest.

**Authentication comes before the body.** Every step below is decided from the
request line, the headers and — for the two `429`s — what the server remembers
of earlier failures and writes, never from the body. They run in this order, and each refusal closes the
connection without reading the body
(`packages/server/src/infrastructure/http-write.ts:494-633`):

1. `404` `{"error":"not found"}` — the path is not a route. `405` with that
   path's `Allow` — it is one, and this method does not write to it.
2. The query is read, and the `404` of a route no configured token could ever
   authorize is decided from it: `POST /api/v1/projects` is `404` only when
   neither token is configured, `?rotate=1` and `DELETE /api/v1/projects/<id>`
   are `404` whenever the admin token is not, whatever the enrollment token is
   (`adminRouteEnabled`, `packages/server/src/application/enrollment.ts:69-79`;
   `packages/server/src/infrastructure/http-write.ts:517-537`). This step comes
   before step 3 because `rotate` is part of the question; the `400` itself does
   not.
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
   `POST_BODY_CAP`, `packages/server/src/infrastructure/http-write.ts:50-51`).
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
   exist. On the two admin routes the digest is compared against both of this
   service's own digests instead, which answers a kind; `authorize` then turns
   that into the admin power, the enrollment power, or the refusal above. Each
   `401` and `403` of this step counts as one failure against the address in
   step 6 (`digestOf`, `kindOf`, `refused`, `authenticateWave`, `denied`,
   `packages/server/src/infrastructure/http-write.ts:286-297`, `324-367`,
   `396-408`).
8. `429` `{"error":"too many writes"}` with `Retry-After: 1` — one write per
   second per project, counting every authenticated attempt and not only the
   accepted ones. The admin token's requests share one allowance, and the
   enrollment token's have one of their own at the same rate, so a leaked
   enrollment token cannot keep the admin token's cleanup at `429`
   (`PROJECT_INTERVAL_MS`, `packages/server/src/application/limiters.ts:5`;
   `ADMIN_LIMITER_KEY` and `ENROLL_LIMITER_KEY` in
   `packages/server/src/infrastructure/http-write.ts`). Neither key can be a
   project id.

The client address in step 6 is the socket's, or with `WAVES_TRUST_PROXY=1` the
last entry of `X-Forwarded-For`
(`clientAddress`, `packages/server/src/infrastructure/client-address.ts:54-63`).

Only then is the body read. A client that sent `Expect: 100-continue` over
HTTP/1.1 gets its `100 Continue` here and not before, so a client that waits for
it never sends a body to a refusal; a client that does not wait and is refused
sees the connection reset mid-body (`continueIfExpected`,
`packages/server/src/infrastructure/http-write.ts:248-257`;
`SendOptions`, `packages/server/src/infrastructure/http-security.ts:47-66`).

Over HTTP/1.1, an `Expect` header with any other value never reaches this
pipeline: the service
answers it itself, before any route, any authorization and even before the URL
length is looked at, with `417` `{"error":"expectation failed"}`, the headers of
section 5.3 and — on a path under `/api/` — `Cache-Control: no-store`. The
connection is closed rather than left for a body nobody will read, and the
answer is logged like any other (`checkExpectation`,
`packages/server/src/infrastructure/http-server.ts:333-343`).

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
- `403` `{"error":"enrollment ceiling reached"}` — a registration under the
  enrollment token with 64 projects already in the registry, and nothing else.
- `200` `{"receivedAt":"…"}` for a push: the server's own clock at the moment it
  stored the snapshot, which is the instant every rule of section 4 reads. A
  push replaces the wave's previous snapshot; the server keeps one per wave.

(`readBody`, `replyFor`, `register`, `push`,
`packages/server/src/infrastructure/http-write.ts:299-313`, `374-388`, `410-487`;
`putWave`, `packages/server/src/application/write-model.ts:126-134`)

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
`packages/contract/src/domain/envelope.ts:520`).

The closed-object rule is what makes a version meaningful. Under `v1` a new
**optional** field is an additive minor change: old readers refuse to accept it
today, so a reader has to be upgraded first, and the server will only treat it
as additive once the closed key list actually gains the key. Anything else —
removing a field, renaming one, narrowing a bound, changing a type, making an
optional field required — needs `waves/v2` and a new `SCHEMA`. `prs` and
`backlog` are not planned envelope fields: they are keys of the second document,
"The project status document", and the wave envelope does not carry them.

A registration body is **not** under `schema: "waves/v1"` — it carries no
schema at all — so the project rule is versioned by the package rather than by
the envelope schema, and a minor version may tighten it.

Contract **0.2.0** adds the project status document and tightens `repo`: a new
document, a new export and a stricter character rule, which is what a minor
version of this package is for.

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
