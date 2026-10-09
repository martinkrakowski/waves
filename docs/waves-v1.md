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

`validateEnvelope` is the whole gate for a wave (a project's status has its own,
`validateStatus`; see "The project status document"). It is exported from
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
(`normalise`, `packages/contract/src/domain/status.ts:90`).

**Staleness.** The clock is the server's and the instant it uses is when the
server received the document, exactly as section 4 for a wave: the status is
stale when the time since its receive is longer than
`staleAfterMs(intervalSeconds)`, with the same `null` default of 300 s.
`generatedAt` is stored and echoed, and no rule reads it.

**And nothing on the page shows it.** The API answers `stale` and
`staleAfterMs`, and the project summary answers `stale`, because those are the
facts and a client may want the rule — but the page shows only when the document
arrived. The reason is the bound above: a status's window is capped at 300 s, and
a project that pushes a status once per run would be badged stale nearly every
time a reader looked, so a badge about it would be a badge that is almost always
on and never actionable. The received time is the fact behind the badge, and it
is what is drawn instead — on the fleet row's own status line and in the status
panel, never as a warning (`statusFact`,
`packages/server/public/views/fleet-rows.js:141-154`; the panel's own note,
`packages/server/public/views/status-panel.js:14-19`).

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

## The notice document

A project may also push **notices** beside its waves and its status: one-off
records that are not carried in a wave envelope, are not subject to wave staleness
or retention, and are addressed by their own id. A notice has a `kind`:
`decision` or `event`. Neither is a lane, and neither lives in a wave (W52).
(`packages/contract/src/domain/notice-decision.ts`,
`packages/contract/src/domain/notice-state.ts`,
`packages/contract/src/domain/notice-event.ts`,
`packages/contract/src/index.ts`)

### The decision revision

`validateDecision` is the gate. It is pure, exported from
`@hexagen-monaco/waves-contract`, and returns either `{ ok: true, value }` or
`{ ok: false, errors }`. A decision revision is a closed object with keys exactly
`schema`, `kind`, `project`, `id`, `shape`, `question`, `options`, `recommended`,
`hardToUndo`, `commits`, `decider`, `appliesTo`, `evidence`, `actElsewhere`,
`raisedBy`, `raisedAt`, `refs`, `changeNote` (`DECISION_KEYS`,
`packages/contract/src/domain/notice-decision-readers.ts`).

| field          | type             | required | bounds                                                          |
| -------------- | ---------------- | -------- | --------------------------------------------------------------- |
| `schema`       | string           | yes      | exactly `"waves-notice/v1"` (`NOTICE_SCHEMA`, `…/model.ts`)     |
| `kind`         | string           | yes      | exactly `"decision"`                                            |
| `project`      | string           | yes      | the project id of section 2.1                                   |
| `id`           | string           | yes      | the lane id shape of section 2.1 (1 to 80 chars, `A-Za-z0-9_-`) |
| `shape`        | string           | yes      | `choice` \| `action` \| `instruction`                           |
| `question`     | string           | yes      | 1 to 300 characters, NFC, no leading/trailing white space       |
| `options`      | array            | yes      | see below                                                       |
| `recommended`  | object           | no       | `{ option, reason }`, see below                                 |
| `hardToUndo`   | object           | yes      | `{ value, reason? }`, see below                                 |
| `commits`      | array of strings | yes      | at most 8, each 1 to 2000 chars                                 |
| `decider`      | string           | yes      | `owner` \| `delegated`                                          |
| `appliesTo`    | array of strings | yes      | project ids, unique, at most 16, may be empty                   |
| `evidence`     | array            | yes      | at most 8, see below                                            |
| `actElsewhere` | object           | no       | `{ where, what }`; required for `action`                        |
| `raisedBy`     | string           | yes      | at most 80 characters, NFC, no leading/trailing white space     |
| `raisedAt`     | string           | yes      | strict ISO-8601 UTC, see 2.5                                    |
| `refs`         | object           | no       | `{ wave?, lane?, pr? }`, see below                              |
| `changeNote`   | string           | no       | 1 to 2000 characters, NFC, no leading/trailing white space      |

**Optional keys are absent, never `null`.** If a key appears with the value
`null` the validator refuses it as "expected an object" (or "expected a string",
as the field's reader decides). This corrects the JSON example in
`docs/planning/2026-10-08_decisions-inbox.md` section 4.1, which showed
`"actElsewhere": null`.

**Every text is refused when it is not Unicode NFC or has leading or trailing
white space; it is never repaired.** The reader checks
`value.normalize("NFC") === value`, and a first or last character that matches
`/[\s\u0085]/u` is refused, which `trim()` would not do for U+0085
(`readNoticeText`, `packages/contract/src/domain/notice.ts:38-57`). `readText` from
section 2.6 is not changed; this document has its own strict reader because the
envelope never applied the NFC or trim rule.

**Options.** A closed object with keys exactly `key`, `text`, `cost`, all
required strings. `key` matches `^[a-z0-9]{1,8}$` (`OPTION_KEY_PATTERN`,
`…/model.ts`); keys are unique (`…/notice-decision-readers.ts:96-149`). At most
8 options (`MAX_OPTIONS`, `…/model.ts`).

**Recommended.** A closed object with keys exactly `option` and `reason`, both
required text. `option` must be one of the option keys of this decision.
Absent is valid for `choice`; it is refused on `action` and `instruction`
(shape rule, below).

**`hardToUndo`.** A closed object with keys exactly `value` and `reason`. `value`
is `true`, `false` or the string `"partly"` (`DoorValue`, `…/model.ts`).
`reason` is required unless `value` is `false`. The reason is one sentence; the
page shows it verbatim (`packages/contract/src/domain/notice-decision-readers.ts:179-197`).

**Evidence.** Each entry is a closed object with keys exactly `label` and
`href`. `label` is 1 to 80 characters. `href` must begin `https://` and hold no
white space or control character (`…/notice-decision-readers.ts:75-94`).

**`refs`.** A closed object with keys exactly `wave`, `lane`, `pr`. `wave` is a
wave id, `lane` a lane id, `pr` an integer ≥ 1. All optional (`readRefs`,
`packages/contract/src/domain/notice.ts`).

**Bounds** (`packages/contract/src/domain/model.ts`):

| constant              | value             |
| --------------------- | ----------------- |
| `MAX_OPTIONS`         | 8                 |
| `MAX_COMMITS`         | 8                 |
| `MAX_EVIDENCE`        | 8                 |
| `MAX_APPLIES_TO`      | 16                |
| `MAX_QUESTION_CHARS`  | 300               |
| `MAX_TEXT_CHARS`      | 2000              |
| `MAX_LABEL_CHARS`     | 80                |
| `MAX_RAISED_BY_CHARS` | 80                |
| `OPTION_KEY_PATTERN`  | `^[a-z0-9]{1,8}$` |

**Shape rules.** Each is refused at the path of the field it is about:

| shape         | options | recommended | actElsewhere | appliesTo |
| ------------- | ------- | ----------- | ------------ | --------- |
| `choice`      | 2 to 8  | optional    | optional     | any       |
| `action`      | empty   | forbidden   | **required** | any       |
| `instruction` | empty   | forbidden   | optional     | ≥ 1       |

### The binding text

`decisionBindingText` returns the canonical JSON text that the server hashes to
produce `textSha256` and that the client hashes to verify a signed answer
(stage 2). It is pure and total: given a validated `DecisionRevision` it returns
one JSON text, no white space between tokens, built with an explicit key order
(`packages/contract/src/domain/notice-decision.ts:142-172`):

```
{"question":…,"shape":…,"options":[{"key":…,"text":…,"cost":…}],"recommended":{"option":…,"reason":…}|null,"hardToUndo":{"value":…,"reason":…|null},"commits":[…],"decider":…,"appliesTo":[…],"actElsewhere":{"where":…,"what":…}|null}
```

Two revisions that differ only in `evidence`, `refs`, `raisedBy`, `raisedAt`,
`changeNote`, `project` or `id` produce the same text; any difference in a
binding field — including the order of options — produces a different text. The
hashing itself is done by the server and client in their own `infrastructure/`
in later lanes.

### The state-entry request

A session posts a state entry to change a decision's state. `validateStateEntry`
is the gate (`packages/contract/src/domain/notice-state.ts`). A state entry is a
closed object with keys exactly `state`, `source`, `revision`, `textSha256`,
`expectedEntries`, `by`, `at`, `words`, `option`, `reason`, `supersededBy`.

| field             | type    | required | bounds                                                                                                        |
| ----------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `state`           | string  | yes      | `delegated` \| `approved` \| `declined` \| `answered` \| `withdrawn` \| `superseded`; `open` is never written |
| `source`          | string  | yes      | `session` \| `reported`; `signed` is refused (stage 2 only)                                                   |
| `revision`        | integer | yes      | ≥ 1                                                                                                           |
| `textSha256`      | string  | yes      | 64 lower-case hex characters                                                                                  |
| `expectedEntries` | integer | yes      | ≥ 0                                                                                                           |
| `by`              | string  | yes      | 1 to 80 characters, NFC, no leading/trailing space                                                            |
| `at`              | string  | yes      | strict ISO-8601 UTC                                                                                           |
| `words`           | string  | no       | 1 to 2000 characters, NFC, no leading/trailing space                                                          |
| `option`          | string  | no       | `^[a-z0-9]{1,8}$`                                                                                             |
| `reason`          | string  | no       | 1 to 2000 characters                                                                                          |
| `supersededBy`    | string  | no       | a lane id                                                                                                     |

**Source by state.** `approved`, `declined` and `answered` require
`source: "reported"` and `words`; they are refused with `source: "session"`.
`delegated`, `withdrawn` and `superseded` require `source: "session"`
(`applySourceRules`, `…/notice-state.ts:61-106`). `delegated` also requires
`option` or `words`. `withdrawn` requires `reason`. `superseded` requires
`supersededBy`; `supersededBy` is refused on any other state.

Whether the revision, the hash, the entry count and the revision count are current is
the server's check (lane I2), not this function's: `appendEntry` compares all of
them inside the store's serialised read-compare-write and answers `409` with the
current three when any differs (`packages/server/src/application/ports/notice-store.ts:101`).
When the store answers `conflict` the write model re-reads the decision and
returns that re-read's revision, hash and entry count in the `409`
(`packages/server/src/application/notice-write-model.ts:273`).
A `textSha256` of any 64 hex characters is accepted here; the server recomputes it from
the revision via `decisionBindingText`.

### The event

`validateEvent` is the gate (`packages/contract/src/domain/notice-event.ts`). An
event is a closed object with keys exactly `schema`, `kind`, `project`, `topic`,
`text`, `detail`, `at`, `refs`.

| field     | type   | required | bounds                                              |
| --------- | ------ | -------- | --------------------------------------------------- |
| `schema`  | string | yes      | exactly `"waves-notice/v1"`                         |
| `kind`    | string | yes      | exactly `"event"`                                   |
| `project` | string | yes      | the project id                                      |
| `topic`   | string | yes      | the stage shape `^[a-z][a-z-]{0,31}$`               |
| `text`    | string | yes      | 1 to 300 characters, NFC, no leading/trailing space |
| `detail`  | string | no       | 1 to 2000 characters                                |
| `at`      | string | yes      | strict ISO-8601 UTC                                 |
| `refs`    | object | no       | see above                                           |

An event is one immutable entry: no states, no revisions, no answer. The store
assigns its id — a per-project sequence carried in the id, taken as the last
stored event's sequence plus one inside the serialised append — so dropping the
oldest event cannot free an id for a colliding new one, and two events in the
same millisecond cannot share one; the writer answers the id the store returns
(`nextEventSequence`, `packages/server/src/infrastructure/store-helpers.ts:32`).
The events of a project are one append-only array in `events/<project>.json`;
an append to a file that exists but is not a JSON array is refused and the file
is left untouched, never replaced with only the new event
(`readEvents`, `packages/server/src/infrastructure/file-notice-store.ts:170`).

### Worked example

A small choice decision:

```json
{
  "schema": "waves-notice/v1",
  "kind": "decision",
  "project": "alpha",
  "id": "d1",
  "shape": "choice",
  "question": "What should we do?",
  "options": [
    { "key": "a", "text": "A", "cost": "C1" },
    { "key": "b", "text": "B", "cost": "C2" }
  ],
  "hardToUndo": { "value": false },
  "commits": [],
  "decider": "owner",
  "appliesTo": [],
  "evidence": [],
  "raisedBy": "session",
  "raisedAt": "2026-10-08T12:00:00Z"
}
```

Its binding text (one JSON text, no white space between tokens) is:

```
{"question":"What should we do?","shape":"choice","options":[{"key":"a","text":"A","cost":"C1"},{"key":"b","text":"B","cost":"C2"}],"recommended":null,"hardToUndo":{"value":false,"reason":null},"commits":[],"decider":"owner","appliesTo":[],"actElsewhere":null}
```

### Per-project and per-decision caps

These constants are exported so the server and client read the same numbers
(`packages/contract/src/domain/model.ts`):

| constant                           | value |
| ---------------------------------- | ----- |
| `MAX_DECISIONS_PER_PROJECT`        | 500   |
| `MAX_EVENTS_PER_PROJECT`           | 2000  |
| `MAX_REVISIONS_PER_DECISION`       | 20    |
| `MAX_SESSION_ENTRIES_PER_DECISION` | 50    |

A `ceiling`, `keep` or `limit` that is unset, zero, negative, NaN or otherwise not a
positive safe integer is refused before the store acts: each call checks it or throws a
`RangeError` (`assertPositiveBound`, `packages/server/src/infrastructure/store-helpers.ts:19`).

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
the server (`createReadModel`, `packages/server/src/application/read-model.ts:512`,
`595-852`; `Now`, `…/read-model.ts:25`). `generatedAt` is stored and echoed but
no rule reads it.

In the wave view, a stale wave keeps its lane data but a lane whose
`derived.alive` is `true` is rendered as `"unknown"`, because the pusher has
stopped telling the server whether the process is still up
(`aliveView`, `…/read-model.ts:275-277`).

### 4.1 Keeping waves fresh

A wave only says something while something is pushing it. `waves sync` is the
pusher for a project that has no other one: a scheduler runs it once per period,
it runs each project's own collector and sends what the collector printed, and
`every` — the period — is the `intervalSeconds` of every wave and status it sends.
The arithmetic is therefore §4's own: a wave pushed with `intervalSeconds: 60`
goes stale after `min(3 × 60, 300) = 180` seconds, so it survives two missed ticks
and reads stale on the third, and the ceiling of 100 seconds on `every` keeps that
inside the contract's 300. A collector that prints nothing, or fails, or is never
run, sends no new snapshot at all — it is never an empty wave and never a stale
"alive". What the dashboard shows then is §4's arithmetic on what is already
stored: a wave pushed once turns stale only once `staleAfterMs` has passed since
its last receive, a project that has never pushed a wave stays absent, and a stale
wave keeps its lanes, with only a lane whose `derived.alive` is `true` rendered as
`unknown`, because a pusher that has stopped can no longer vouch for it. A
collector that failed is visible in the run's own log and nowhere else, which is
the honest answer rather than a snapshot nobody looked at.

The shape of `sync.json`, the collector contract, the trust boundary and the exit
codes are in the client's README (`packages/client/README.md`, "Keep the waves
fresh"); the rules above are the ones this contract fixes.

## 5. HTTP API

### 5.1 Read routes

A request is decided in this order, and the order is what picks the status you
see (`respond`, `packages/server/src/infrastructure/http-server.ts:186-262`):

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

| path                                                                                | 200 response                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /healthz`                                                                      | `{"ok":true}` — the process is up                                                                                                                                                                                                                                                                                              |
| `GET /readyz`                                                                       | `{"ok":true}` — the store can be read; otherwise `503` `{"ok":false}`                                                                                                                                                                                                                                                          |
| `GET /api/v1/projects`                                                              | array of `{ id, name, repo?, registeredAt, waves, lanes, lastPush?, stale, recentWaves, status?, decisions? }`, see below                                                                                                                                                                                                      |
| `GET /api/v1/projects/<id>/waves`                                                   | array of `{ wave, receivedAt, intervalSeconds, lanes, stale, retained }`, `lanes` a count, newest receive first                                                                                                                                                                                                                |
| `GET /api/v1/projects/<id>/lanes`                                                   | `{ project: { id, name, repo? }, waves: [...], wavesOmitted, lanes: [...], truncated }`, see 5.1.1                                                                                                                                                                                                                             |
| `GET /api/v1/projects/<id>/waves/<wave>`                                            | `{ envelope, receivedAt, stale, staleAfterMs }`, where `envelope` is the stored envelope with `lanes[].derived.alive` possibly `"unknown"`                                                                                                                                                                                     |
| `GET /api/v1/projects/<id>/status`                                                  | `{ status, receivedAt, stale, staleAfterMs }`, where `status` is the stored document of "The project status document"                                                                                                                                                                                                          |
| `GET /api/v1/attention`                                                             | `{ lanes: [{ project, wave, lane, seat?, reasons, receivedAt, stale, pr? }], projects: [{ id, attention }], truncated, wavesOmitted }`, see below                                                                                                                                                                              |
| `GET /api/v1/projects/<id>/decisions`                                               | `{ project, counts, decisions: [Head] }`, the project's own and every instruction of another project that applies to it, see 5.1.4                                                                                                                                                                                             |
| `GET /api/v1/projects/<id>/decisions/<decision>`                                    | `{ head, revisions: StoredRevision[], entries: StoredEntry[] }`, or `404` if there is no such decision                                                                                                                                                                                                                         |
| `GET /api/v1/projects/<id>/events`                                                  | `{ events: StoredEvent[] }`, newest first, at most `MAX_NOTICE_EVENTS` (200)                                                                                                                                                                                                                                                   |
| `GET /api/v1/inbox`                                                                 | `{ projects: [{ id, name, counts, decisions: [Head] }] }`, one entry per registered project in registry order; `decisions` holds each project's own heads only — `from` is never set here, so an instruction one project raised and applied to another appears only on that project's `/decisions` listing, never on the inbox |
| `GET /` and `/inbox` — and `/p/<id>`, `/p/<id>/w/<wave>` and `/p/<id>/d/<decision>` | the status page (`public/index.html`)                                                                                                                                                                                                                                                                                          |
| `GET /<static file>`                                                                | a file from `public`, allow-listed extensions only                                                                                                                                                                                                                                                                             |

#### 5.1.4 The notice head, the groups and the counts

A decision head is `{ project, id, question, shape, door: { value, reason? }, decider, revision, revisions, textSha256, entries, state, source?, at, group, actElsewhere?, earlierAnswer?, coveredAnswer?, from? }`. `at` is the current entry's receive time, or the current revision's when the state is `open`. `decisions` on a summary is `{ waiting, oneWay, reported, closed }`: `oneWay` counts the `waiting` decisions whose door value is `true`, and the four are never summed into one number. A head's `group` is `waiting` (state `open` or `delegated`), `reported` (a current answer entry received within the last fourteen days), `closed` (a current `withdrawn` or `superseded` entry within fourteen days), or `history` otherwise; a reported answer stays in `reported` for fourteen days and then moves to `history`, so it can never leave the inbox while it stands (rule 1). `from` carries the project a listed instruction was raised by. The current entry
is the last entry on the current text — the unbroken tail of revisions sharing
the current revision's `textSha256` — so a text that returns to one a decision
used before cannot wake the entry that stood under an earlier revision of it;
an entry is current only when its hash matches and its `revision` is at or after
the first revision of that run (`currentEntry`, `packages/server/src/domain/decision-state.ts:61`).

In a project summary `waves` is a count, `lanes` is the number of lanes in the
project's **retained** waves summed from the wave heads, `lastPush` is the newest
`receivedAt` in the project, and `stale` is the staleness of the project's
**newest** wave by the rule of section 4; a project with no waves is not stale
and has no lanes. The token digest is never part of a response.

`recentWaves` is the project's newest at most `MAX_RECENT_WAVES` (12) **retained**
waves, newest receive first, and it is never absent: a project with no retained
wave answers `[]`. Each entry is
`{ wave, receivedAt, lanes, state, stale, merged }`:

- `wave` and `receivedAt` name the wave and when this server received it.
- `lanes` is how many lanes the wave holds, and `merged` how many of them have a
  pull request whose state is `merged`. A closed pull request is answered and is
  not counted here, and `merged` is never greater than `lanes`.
- `stale` is the rule of section 4 applied to **this wave's** own receive time
  and its own `intervalSeconds`, the same way `WaveSummary.stale` and the
  attention view report a wave's staleness. It is a separate boolean from
  `state`, because every finished wave goes stale when its pushes stop.
- `state` is what the wave's lanes say about the wave, decided in this order and
  no other (`waveState`, `packages/server/src/domain/wave-state.ts:52-72`):

| state     | holds when                                                                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `failed`  | some lane whose pull request is neither merged nor closed is not alive, and either reported `event: "failed"` or has an `exit` that is defined and non-zero |
| `done`    | there is at least one lane and every lane's pull request is `merged` or `closed`                                                                            |
| `running` | the wave is not stale and some lane is alive (the raw `derived.alive`, before staleness resolves it to `"unknown"`)                                         |
| `settled` | everything else, including a wave with no lanes at all                                                                                                      |

A `failed` wave is therefore one with a lane that asked and is not being asked
any more: a merged or closed pull request is answered whatever the lane left
behind, and `attentionReasons` makes the same exclusion (section 5.1). The `!alive`
requirement holds for a **reported** failure as well as for an exit, which is one
deliberate difference from the `failed` reason: a lane that is still alive has
not finished failing, so the wave is `running` instead. `running` says a lane is
alive in a wave that has not gone past its own interval, so an alive lane in a
stale wave is `settled` — the pusher has stopped saying. The state summarises
what the lanes said, not what the work is.

**The summary reads wave files.** It used to read heads and never wave files,
which is why `lanes` was summed from the heads it had already read. It no longer
is: the recent waves are read through the same cache the project listing and
`GET /api/v1/attention` use (`cachedWave`,
`packages/server/src/application/read-model.ts:725-754`), so a poll over a fleet
of N projects parses at most 12 × N snapshots when it is cold and **none** when
it is warm — the second poll finds the same heads describing the same waves and
answers from the cache. A wave the cache answers `undefined` for — one that went
away between the heads and the snapshot — is skipped rather than listed empty,
because there is nothing there to describe.

The bound is a fact about the cache as much as about the answer: 12 × N stays
inside `MAX_CACHED_WAVES` (512) while the rows it holds stay under
`MAX_CACHED_ROWS` (10 000) for about 42 projects. Past that a `?all=1` listing of
one large project can evict fleet entries, which then cost one parse each on the
next poll. A wave's `receivedAt`, `lanes` and `stale` are read from the entry
rather than from the head the wave was chosen by, as `listAttention` already does
— a push can land between the heads and the snapshot, and a `lanes` from the head
beside a `merged` from the snapshot would break `merged <= lanes`. Retention and
the order come from the same `waveSummaries` every other listing uses, so the
waves listed are the newest retained ones whatever order the store answered its
heads in, and a wave past the retention is never read at all (`recentWaves`,
`…/read-model.ts:786-802`; `recentWave`, `…/read-model.ts:647-671`; `MAX_RECENT_WAVES`,
`…/read-model.ts:91-101`; `RecentWave`, `…/read-model.ts:114-133`; `listProjects`,
`…/read-model.ts:805-837`).

`status` is the project's own status document reduced to the two facts a fleet
card shows, never the document itself:
`{ receivedAt, stale, prsSkipped?, backlogState? }`. It is **absent** when the
project has pushed no status, and `prsSkipped` and `backlogState` are each
present exactly when the document carries the field they come from — a
`prsSkipped` of `0` a reader would take for a count, and a document that never
mentioned `prs` did not report one. `stale` is the rule of section 4 applied to
the status's own receive time and its own `intervalSeconds`
(`ProjectSummary.status`, `packages/server/src/application/read-model.ts:163-177`;
`getStatus`, `…/read-model.ts:1096-1110`).

`GET /api/v1/attention` is the same view across every registered project. A lane
is listed when it holds at least one of seven reasons, and the reasons always come
back in this order:

| reason         | holds when                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `failed`       | `reported.event` is `"failed"`                                                                                                                                  |
| `disagreement` | `disagreements` is not empty                                                                                                                                    |
| `checks`       | `derived.pr.checks` is `"fail"`                                                                                                                                 |
| `gate`         | `derived.gate.exit` is a number other than `0`                                                                                                                  |
| `exit`         | `derived.alive` is `false` and `derived.exit` is a number other than `0`                                                                                        |
| `silent`       | the wave is stale, `derived.alive` is `true` and `derived.exit` is not there                                                                                    |
| `no-pr`        | `reported.stage` is `merge` or `merged` with `reported.event` `"settled"`, or `reported.stage` is `record`, and neither `reported.pr` nor `derived.pr` is there |

The contract leaves `stage` to the project, so it has no order of stages to
read "merged or later" from, and `no-pr` knows three names and no others:
`merge` and `merged`, which count only once the event is `settled`, and `record`,
the stage after a merge, which counts at any event (`NO_PR_STAGES`, `holdsNoPr`,
`packages/server/src/domain/attention.ts:51-77`). A lane at `deploy`, `deployed`, `tag`
or any other stage never holds it, because such a lane can have no pull request
and be right. The cost is silent: **a project that names its merge stage
anything else is never asked about by this reason**, and nothing on the page
says so. A project that adopts another name for it has to say so here, so the
name can be added to the list. A lane with a pull request in any state never
holds the reason, and neither does a lane that named a `reported.pr` with no
`derived.pr`: a number was given.

A lane whose `derived.pr.state` is `merged` or `closed` holds none of them,
whatever else it is carrying (`attentionReasons`,
`packages/server/src/domain/attention.ts:93-128`). Only the waves the server
received in the last 72 hours take part, counted on the receive time as
`nowMs - Date.parse(receivedAt) <= 72 * 60 * 60 * 1000` (`inAttentionWindow`,
`ATTENTION_WINDOW_MS`, `…/domain/attention.ts:131-136`, `22`). Those heads are
collected from every project and sorted newest receive first before any snapshot
is read, and at most `MAX_ATTENTION_WAVES` (256) of them are read at all, so
which waves a request reads is decided by receive time and never by the order the
store answered its heads in. Each project's newest wave in the window comes
before any project's second, so one busy project cannot fill the bound on its
own and leave the others at zero. `wavesOmitted` is how many in-window waves holding at least one lane that left
out, and `truncated` is `true` whenever it is above zero: the list may then be
missing lanes, and no other field says how many waves were behind them.

The lanes are ordered by receive time descending and cut at 200
(`MAX_ATTENTION_LANES`, `…/domain/attention.ts:25`); the sort is stable, so lanes
received within the same millisecond keep the order they were found in.
`projects` carries one entry per registered project, in the order the registry
answers it, and `attention` counts that project's lanes **before** the lane cut —
a project whose lanes the cap left out still says how many it wanted. The count
covers the waves that were **read**, so a project none of whose waves was read is
still there, with `0`.

The route reads the wave heads of every project and then the lanes of the waves
still inside the window, through the same cache the project listing uses, and
never `listSnapshots`: a fleet of projects is answered from one wave each.
`MAX_ATTENTION_WAVES` is below the cache's own wave bound (`MAX_CACHED_WAVES`,
512), so the wave bound alone can never make one request evict the entry it is
about to read next; the row bound (`MAX_CACHED_ROWS`) still can, when the waves
are large ones, which is what the cache is for. A wave's staleness here is read
from the snapshot it answered with — its own receive time and its own interval —
so a push that lands between the heads and the snapshot is judged by the push
(`listAttention`, `packages/server/src/application/read-model.ts:731-841`;
`MAX_ATTENTION_WAVES`, `…/read-model.ts:80-89`).

(`route`, `packages/server/src/infrastructure/http-routes.ts:124`;
`replyFor`, `readyReply`, `packages/server/src/infrastructure/http-server.ts:98-149`;
`ProjectSummary`, `StatusView`, `WaveSummary`, `WaveView`,
`packages/server/src/application/read-model.ts:91-169`;
`SnapshotHead`, `packages/server/src/application/ports/store.ts:8-13`)

#### 5.1.1 `GET /api/v1/projects/<id>/lanes`

Every lane of one project, so that a page which shows a project's lanes across
its waves needs no request per wave:

```
{ project: { id, name, repo? },
  waves:  [ { wave, receivedAt, intervalSeconds, lanes, stale, retained } ],
  wavesOmitted,
  lanes:  [ { wave, id, seat?,
              reported?: { stage, event, ts, pr?, round? },
              derived: { alive, exit?, gate?, pr?, diff?, planReview?, risk?,
                         log?: { bytes, mtimeMs, tail } },
              disagreements, disagreement?, reasons } ],
  truncated }
```

`waves` is the newest `MAX_LISTED_WAVES` (1 000) of what
`GET /api/v1/projects/<id>/waves` answers, in the same order, so the wave strip
beside the table needs no second request. `lanes` holds the rows of the waves this
request covers, newest wave first and each wave's own order within it, and a row's
`wave` names the wave it came from.

**The wave list is cut; the rows are not.** `waves` holds at most the newest 1 000
heads, because nothing deletes a wave past the retention and a project that pushes
a new wave id every ten minutes reaches a thousand of them in a week; at about 190
bytes a head that bounds the strip near 190 KiB. Retention is a function of the
receive time alone (`isRetained`, section 4), so in this newest-first list every
retained head already precedes every unretained one: the bound never keeps a wave
past retention in place of a retained one. `wavesOmitted` is how many heads are
missing. The **rows** are not cut with the list — the row loop walks every head
the store holds and its own bounds below stop it, so a wave too old to be listed
may still have its lanes in `lanes`, and `truncated` means exactly what it did
before this bound existed (`MAX_LISTED_WAVES`,
`packages/server/src/application/read-model.ts:59-68`).

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
(section 4); a wave past the retention is still in `waves` while the bound has
room for it, with `retained: false`, and contributes no rows. `?all=1` widens
the waves whose rows are collected to every wave the store holds; it does not lift
the bound on `waves`, which still lists at most the newest `MAX_LISTED_WAVES`.

**The query.** The part of the target after the first `?` must be empty — no `?`
at all, or a bare trailing `?` — or exactly `all=1`. Anything else is a `400`
`{"error":"bad query"}` with the same headers as any other API answer, including
`Cache-Control: no-store`. This is the **only** read route that reads its query
string: every other one ignores it, and the access log keeps logging the path
alone. The check is step 8 of section 5.1, so an unauthenticated request with a
bad query is a `401`, a `PATCH` with a bad query is a `405`, and a bad query on
an unknown project is a `400` rather than a `404`. `HEAD` gets the same status as
`GET` with no body (`queryOf`, `…/http-routes.ts:108-110`; `ALL_WAVES` and the
check itself, `packages/server/src/infrastructure/http-server.ts:61`, `233-253`).

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
`packages/server/src/application/read-model.ts:30`, `41`, `48`, `57`;
`listLanes`, `…/read-model.ts:644-728`).

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
`packages/server/src/application/read-model.ts:384-415`; the cache bounds,
`MAX_CACHED_WAVES`, `MAX_CACHED_ROWS`, `remember`, `cachedWave`,
`…/read-model.ts:77-78`, `543-593`).

`404` `{"error":"not found"}` for an unknown project, as on the other project
routes, and `405` with `Allow: GET, HEAD` for any other method.

Status codes:

- `200` with the shape above.
- `404` `{"error":"not found"}` — an unknown project, an unknown wave, a path
  that is not a route, or a static file that is not there. A `project` or
  `wave` segment that fails the id pattern is not a route at all, so it is a
  `404` and never reaches the store
  (`packages/server/src/infrastructure/http-routes.ts:134-158`).
- `405` `{"error":"method not allowed"}` with the `Allow` of that path:
  `GET, HEAD, POST` on the project collection, `DELETE` on a single project,
  `GET, HEAD, PUT` on a project's status, `GET, HEAD, PUT, DELETE` on a wave,
  and `GET, HEAD` everywhere else — `/api/v1/attention` and
  `/api/v1/projects/<id>/lanes` among that last group
  (`ALLOWED`, `packages/server/src/infrastructure/http-routes.ts:31-43`).
- `400` `{"error":"bad query"}` — only on `/api/v1/projects/<id>/lanes`, and only
  for a query string that is neither empty nor exactly `all=1` (section 5.1.1).
  It is answered after the token and the method, and it carries `no-store` like
  every other API answer.
- `414` `{"error":"uri too long"}` — a request target over 2048 bytes
  (`MAX_URL_BYTES`, `packages/server/src/infrastructure/http-routes.ts:9`).
  This is checked before authentication, so an oversized target is a `414`
  even without a token.
- `431` `Request Header Fields Too Large` — a header block over 16 KiB
  (`MAX_HEADER_BYTES`, `packages/server/src/infrastructure/http-server.ts:54`).
  The request never becomes a request, so the answer is written straight to the
  socket by hand and carries no body; `408` and `400` come from the same
  place for a timed-out or otherwise unparseable request
  (`parserRefusal`, `refuseParsedRequest`,
  `packages/server/src/infrastructure/http-security.ts:146-176`).
- `500` `{"error":"internal"}` — anything that throws while building a reply
  (`packages/server/src/infrastructure/http-server.ts:264-292`).
- `401` `{"error":"unauthorized"}` with `WWW-Authenticate: Basic realm="waves",
charset="UTF-8"` — only when a read token is configured and the path is
  neither `/healthz` nor `/readyz`
  (`packages/server/src/infrastructure/http-server.ts:211-220`).

#### 5.1.2 `GET /api/v1/projects/<id>/status`

What one project last said about itself — the document of "The project status
document", whole, with the two facts a rule reads about it:

```
{ status: { schema, project, generatedAt, intervalSeconds, prs?, backlog? },
  receivedAt, stale, staleAfterMs }
```

`stale` and `staleAfterMs` are the rule of section 4 on the status's own receive
time and its own `intervalSeconds` — the same two numbers, from the same clock,
as the wave route answers for a wave, and the `null` default is the same 300 s.
The document is echoed exactly as it was stored, `generatedAt` included.

A project that has pushed no status and a project this server has never heard of
are the **same** `404 {"error":"not found"}`, exactly as they are for a wave: a
reader cannot be told which of them it is, and one answer for both is the cheaper
of the two. There is no "empty status" document — a project that has nothing to
report says so by pushing a document carrying neither `prs` nor `backlog`, which
is a `200` and still refreshes the receive time. The viewer token of section 5.2
and `HEAD` apply here as they do for every other read.

(`/api/v1/projects/<id>/status`, `ALLOWED`,
`packages/server/src/infrastructure/http-routes.ts:31-43`, `124`;
`readModel.getStatus`, `packages/server/src/infrastructure/http-server.ts:133-136`;
`getStatus`, `packages/server/src/application/read-model.ts:947-958`)

#### 5.1.3 The status page's own query string

The three page routes — `/`, `/p/<id>` and `/p/<id>/w/<wave>` — are the static
file, so **the server never reads their query string**: it is ignored on every
one of them, exactly as on every read route but `…/lanes` (section 5.1.1). What
the page does with it is the page's business, and it is worth writing down here
because the answer it draws is a function of the URL.

The page reads seven parameters, each with the rule it has to pass, and one that
is absent, empty or fails its rule is simply not there — never echoed back into
the page and never passed on (`parseQuery`,
`packages/server/public/query.js:62-91`):

| parameter | reads on   | value                                                      |
| --------- | ---------- | ---------------------------------------------------------- |
| `tab`     | `/`        | `active`, `flagged` or `quiet`; absent means every project |
| `q`       | every page | up to 80 printable characters, case-insensitively          |
| `reason`  | a project  | one of the seven reasons of section 5.1                    |
| `stage`   | a project  | the contract's stage shape, 1 to 32 characters of `[a-z-]` |
| `seat`    | a project  | up to 128 printable characters                             |
| `lane`    | a project  | the pusher's own lane id shape; opens the drawer           |
| `all`     | a project  | `1` widens a listing to the waves past the retention       |

**`?tab=`** is the fleet's own filter and is dropped on every other route, so it
can never be carried into a link a project's page draws: a tab says nothing about
a project's waves, and a link that carried it would promise the page something it
does not have (`read`, `packages/server/public/app.js:942-946`; the same rule in
the plan's W39). It is never written as `all` — a filter that names its own
absence is one more thing to parse.

The three tabs partition the fleet, and the partition is decided from the answer
already in hand, in this order:

- **`flagged`** — the newest entry of the project's `recentWaves` is `failed`, or
  the project has attention (the attention view's count for it is above zero).
- **`active`** — not flagged, and some entry of `recentWaves` is `running`.
- **`quiet`** — everything else.

**Staleness is deliberately not one of the three tests.** Every project's pushes
stop eventually, and every finished wave goes stale when they do
(`2026-10-02_next-waves.md:138`), so a rule that read "stale" as "flagged" would
put the whole fleet under one tab on any quiet day and leave `active` and `quiet`
permanently empty. Staleness is still said, where it is about the project rather
than about the fleet: the row's own `stale` pill, and the caption of the projects
stat card (`tabOf`, `packages/server/public/views/fleet-model.js:31-42`).

**`?q=`** on `/` is a substring of a project's **name**, **id** or **repository**,
matched without regard to case, and a project that registered no repository is not
matched by a search for one. It is the same `q` key, the same box and the same
`searchText` cleaning a project's page uses, and both carry `data-key="q"` so `/`
finds them and a redraw puts the caret back where the reader left it.

**Neither asks for anything.** The fleet's two reads are the project list and the
attention view, and they depend on no route parameter at all, so a change of tab
or of search redraws from the answer in hand: `reread()`'s draw-only condition
gains "the route is the fleet before and after" (`sameFleet`,
`packages/server/public/app.js:962-964`, `988-1015`). A tab is a link and a
keystroke replaces the address rather than pushing onto it, so neither fills the
history with one entry per word.

(`TABS`, `packages/server/public/query.js:14-20`; `formatQuery`,
`…/query.js:93-104`; `renderFleet`, `packages/server/public/views/fleet.js:418-436`;
`fleetHandlers`, `packages/server/public/app.js:354-367`)

#### 5.1.5 `/inbox`

`GET /inbox` is the page the owner reads: one block per project, each holding
the decisions `GET /api/v1/inbox` answers with — those in the `waiting`,
`reported` and `closed` groups, in that order, each under its own sub-heading,
and the four counts named separately in a line that never sums them. The inbox
holds each project's **own** decisions only: an instruction one project raised
and applied to another appears on that project's `/decisions` listing (marked
`from` the raiser) and never on the inbox. A project with nothing
listed is one line — its name and "nothing waiting" — so the eye skips it. The
page takes no query string: it is the same answer for every reader, refreshed
with the same ten-second pass the other views use, and it answers nothing.
There is no button, no input, no form: a decision is read here and answered in
the session that owns it, and the word for that is at the foot of the page, not
in a control on it. A session that writes a report or a withdrawal moves a card
from one heading to another and never removes it; the counts name the sources
and never add them up.

#### 5.1.6 `/p/<project>/d/<decision>`

`GET /p/<project>/d/<decision>` is the page for one decision, read-only, and
linked from every inbox card. It is served from the same `index.html` the other
pages are, and answered by `GET /api/v1/projects/<project>/decisions/<decision>`
with `{ head, revisions, entries }`: the head as the inbox carries it, the
revisions oldest-first, and the entries oldest-first. The page's shape check
pins the head to the project and decision the URL names, and the revisions to
1..n in order, before it draws; a response the page cannot read is a failed
load, not a blank page.

The page shows, in order: a breadcrumb from the inbox to the project; the door
band verbatim; the question as the heading; a facts line of shape, who decides,
revision N of M and raised by on the calendar date; the state sentence the
inbox uses, or for `history` the one the group it left would have used plus
"This left the inbox after 14 days"; the options (with the recommended one
marked), the commitments when any, the act-elsewhere line, the evidence links
and the references as plain text; a history of revisions and entries merged by
time; and each earlier text in a collapsed `<details>`. At the foot it says it
does not take an answer: a decision is read here and answered in the session
that asked.

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
plays no part in a write: a project that pushes a wave or a status holds its
project token and no viewer token.

### 5.3 Headers, and no CORS

Every response this service writes carries
`Content-Security-Policy: default-src 'none'; script-src 'self'; style-src
'self'; connect-src 'self'; img-src 'self'; font-src 'self'; object-src 'none';
base-uri 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff` and
`Referrer-Policy: no-referrer`, plus its own `Content-Type` and `Content-Length`
unless it is a `204` (`BASE_HEADERS` and `send`,
`packages/server/src/infrastructure/http-security.ts:14-18`, `68-89`). A path
under `/api/`, the `GET` and `HEAD` answers of `/readyz` and every answer of the
write pipeline also carry
`Cache-Control: no-store` (`isApiPath`,
`packages/server/src/infrastructure/http-routes.ts:113`; `extraFor`,
`packages/server/src/infrastructure/http-server.ts:161-163`, `199-209`;
`answer`, `packages/server/src/infrastructure/http-write.ts:292-302`). The `405`
that an `OPTIONS` or `PATCH` gets on `/readyz` carries no `Cache-Control`; a
`PUT`, `POST` or `DELETE` on it is the write pipeline's `405` and does.

`font-src 'self'` is why the three families `public/fonts.css` declares are
served from this origin and from nowhere else: a `.woff2` is an allow-listed
static file answered as `font/woff2` with these same headers, so a viewer's
browser asks this service for a glyph and never a font host.

There is **no CORS**: no `Access-Control-Allow-Origin` is ever sent, no
`OPTIONS` preflight is answered — an `OPTIONS` request is a `405`, or a `401`
behind a viewer token, with the two probe paths as the only exception: the
viewer token does not guard them, so an `OPTIONS` on `/healthz` or `/readyz` is
always a `405` (section 5.1) — and a write that carries an `Origin` header is
refused (section 5.4). A browser page on another origin therefore can neither
read these routes nor write to them; call them from a server, not from a page.

### 5.4 Write and registration routes

| route                                                    | token                             | body                             | success                                                                                  |
| -------------------------------------------------------- | --------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `PUT /api/v1/projects/<id>/waves/<wave>`                 | project                           | the envelope of section 2        | `200` `{ receivedAt }`                                                                   |
| `PUT /api/v1/projects/<id>/status`                       | project                           | the status document, below       | `200` `{ receivedAt }`                                                                   |
| `DELETE /api/v1/projects/<id>/waves/<wave>`              | project                           | none                             | `204`, or `404` when there was no such wave                                              |
| `POST /api/v1/projects`                                  | admin, or enrollment for a new id | `{ id, name, repo? }`, see below | `201` `{ id, token }`                                                                    |
| `DELETE /api/v1/projects/<id>`                           | admin                             | none                             | `204`, or `404` when there was no such project                                           |
| `PUT /api/v1/projects/<id>/decisions/<decision>`         | project                           | a decision revision              | `200` `{ revision, textSha256, created, entries }`; `400` issues; `409` a bound          |
| `POST /api/v1/projects/<id>/decisions/<decision>/states` | project                           | a state entry                    | `201` `{ index }`; `400` issues; `404`; `409` `{ error, revision, textSha256, entries }` |
| `POST /api/v1/projects/<id>/events`                      | project                           | an event                         | `201` `{ id, dropped }`                                                                  |

(`writeRouteOf`, `packages/server/src/infrastructure/http-routes.ts:76-98`;
`createWriteHandler`, `packages/server/src/infrastructure/http-write.ts:278`)

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
`packages/server/src/infrastructure/http-write.ts:593-602`).

The **enrollment token** is a second, optional secret, read the same way from
the file `WAVES_ENROLL_TOKEN_FILE` names, with the same value rule
(`readEnrollToken`, `packages/server/src/infrastructure/admin-token.ts:68-70`).
It may do exactly one thing: `POST /api/v1/projects` with no query, for an id
that does not exist yet. Everything else is refused: `?rotate=1` and
`DELETE /api/v1/projects/<id>` under it are `403`
`{"error":"enrollment token cannot do this"}`, charged to the address's failure
window like a `401`; a push or a wave delete under it is `401`, as it is for any
token that is not a project's. It never rotates a token, never removes a project
and never touches a wave or a status
(`authorize`, `packages/server/src/application/enrollment.ts:37-52`;
`refused`, `packages/server/src/infrastructure/http-write.ts:380-386`).

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
`packages/server/src/infrastructure/http-write.ts:365-371`)

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
(`REPO_CHARACTER_PATTERN`, `packages/contract/src/domain/project.ts:35`,
`55-58`; the
message is `expected only the characters a URL holds unescaped`). A bare `%` is
in the set, so `b%ZZ` and a trailing `%` pass it, and `new URL` accepts them
too, so both are stored; an internationalised host is refused, because its
letters are not in the set. A `repo` that carries a user or a password is a
`422` as well, with the message `expected no user or password in the URL`: the
URL is stored once and every page that renders it would render the credential
with it (`username` and `password` of the one parse,
`packages/contract/src/domain/project.ts:59-71`). The authority ends at the
first `/`, so a `:` or an `@` in the path is not a credential and
`https://github.com/a:b@c` is still stored. The `201` carries the
project's token — 32 random bytes as base64url, 43 characters — and that answer
is the only time the token exists in clear text anywhere. An id that is already
registered is a `409`, unless the request target is exactly
`POST /api/v1/projects?rotate=1`, which mints a new token for it, invalidates
the old one and keeps its `registeredAt`. A rotation body is a full
registration body: its `name` and `repo` replace the stored ones. `rotate=1` on an id that is not
registered registers it. Deleting a project removes its waves and its status with
it.
(`REGISTRATION_KEYS`, `registerProject`,
`packages/server/src/application/write-model.ts:16`, `152-177`;
`packages/contract/src/domain/project.ts:16-21`;
`mintToken`, `packages/server/src/infrastructure/digest.ts:19`;
`deleteProject`, `packages/server/src/infrastructure/file-store.ts:160-181`)

Under the enrollment token a registration is one serialized store operation that
answers `created`, `exists` or `ceiling`, so two concurrent enrollments of one
id cannot both win and two at the ceiling cannot both pass. Past **64 projects in
the registry** — counting every project however it was registered — an enrollment
answers `403` `{"error":"enrollment ceiling reached"}`, which is _not_ charged to
the failure window, and the admin token still registers. The ceiling is a
constant rather than configuration, and it bounds how many, never what is in it
(`ENROLL_CEILING`, `packages/server/src/application/write-model.ts:43`;
`enrollProject`, `packages/server/src/application/write-model.ts:186-199`;
`createProject`, `packages/server/src/application/ports/store.ts:44-60`;
`FileStore.createProject`, `packages/server/src/infrastructure/file-store.ts:135-156`).

Every registration logs one line through the same `log` as the access log when
the enrollment token made it: `{"ts":"…","event":"enrolled","project":"<id>"}`,
naming the id and never a token or a digest.

**Authentication comes before the body.** Every step below is decided from the
request line, the headers and — for the two `429`s — what the server remembers
of earlier failures and writes, never from the body. They run in this order, and each refusal closes the
connection without reading the body
(`packages/server/src/infrastructure/http-write.ts:568-720`):

1. `404` `{"error":"not found"}` — the path is not a route. `405` with that
   path's `Allow` — it is one, and this method does not write to it.
2. The query is read, and the `404` of a route no configured token could ever
   authorize is decided from it: `POST /api/v1/projects` is `404` only when
   neither token is configured, `?rotate=1` and `DELETE /api/v1/projects/<id>`
   are `404` whenever the admin token is not, whatever the enrollment token is
   (`adminRouteEnabled`, `packages/server/src/application/enrollment.ts:69-79`;
   `packages/server/src/infrastructure/http-write.ts:593-602`). This step comes
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
   `POST_BODY_CAP`, `packages/server/src/infrastructure/http-write.ts:51-52`).
   A status is a `PUT` and takes the `PUT` cap, like a wave: it is a
   project-sized document rather than a body of three keys.
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
   `packages/server/src/infrastructure/http-write.ts:305-317`, `343-427`).
   The three project writes — a push, a status, a wave delete — are all answered
   the same way, by `authenticateWave(digest, project)` against **every** stored
   digest. The admin and the enrollment tokens are not project tokens and cannot
   write any of them: they are `401`, exactly as for a push.
8. `429` `{"error":"too many writes"}` with `Retry-After: 1` — one write per
   second per project, counting every authenticated attempt and not only the
   accepted ones. A project's push, its status `PUT` and its wave delete all
   draw from that one allowance, so a sender spaces its two kinds of write or
   honours `Retry-After`; it does not get one allowance each. The admin token's
   requests share one allowance of their own, and the enrollment token's have one
   of their own at the same rate, so a leaked enrollment token cannot keep the
   admin token's cleanup at `429` (`PROJECT_INTERVAL_MS`,
   `packages/server/src/application/limiters.ts:5`; `ADMIN_LIMITER_KEY` and
   `ENROLL_LIMITER_KEY` in `packages/server/src/infrastructure/http-write.ts`).
   Neither key can be a project id, so a status can never spend the admin
   token's or the enrollment token's.

The client address in step 6 is the socket's, or with `WAVES_TRUST_PROXY=1` the
last entry of `X-Forwarded-For`
(`clientAddress`, `packages/server/src/infrastructure/client-address.ts:54-63`).

Only then is the body read. A client that sent `Expect: 100-continue` over
HTTP/1.1 gets its `100 Continue` here and not before, so a client that waits for
it never sends a body to a refusal; a client that does not wait and is refused
sees the connection reset mid-body (`continueIfExpected`,
`packages/server/src/infrastructure/http-write.ts:267-276`;
`SendOptions`, `packages/server/src/infrastructure/http-security.ts:47-66`).

Over HTTP/1.1, an `Expect` header with any other value never reaches this
pipeline: the service
answers it itself, before any route, any authorization and even before the URL
length is looked at, with `417` `{"error":"expectation failed"}`, the headers of
section 5.3 and — on a path under `/api/` — `Cache-Control: no-store`. The
connection is closed rather than left for a body nobody will read, and the
answer is logged like any other (`checkExpectation`,
`packages/server/src/infrastructure/http-server.ts:337-347`).

After the body:

- `413` `{"error":"body too large"}` — the bytes that arrived went over the cap
  whatever the declared length said, chunked transfer included. The read stops
  at the cap and the connection is closed.
- `400` `{"error":"not utf-8"}` or `{"error":"bad json"}`.
- `422` `{"errors":[{ path, message }]}` — the body fails `validateEnvelope`
  (or, for a status, `validateStatus`, or for a registration the rules above);
  the issues are those of section 3. An envelope whose `project` or `wave`
  differs from the path is a `422` with the single issue `/project`, `expected
the project and wave the path names`. A status names one project and no wave,
  so its mismatch is the same pointer with its own sentence: `/project`,
  `expected the project the path names`.
- `409` `{"error":"already registered"}` — a registration only.
- `403` `{"error":"enrollment ceiling reached"}` — a registration under the
  enrollment token with 64 projects already in the registry, and nothing else.
- `200` `{"receivedAt":"…"}` for a push: the server's own clock at the moment it
  stored the snapshot, which is the instant every rule of section 4 reads. A
  push replaces the wave's previous snapshot; the server keeps one per wave.
- `200` `{"receivedAt":"…"}` for a status, by the same rule and the same clock.
  A status replaces the project's previous one, so there is exactly one document
  per project however many it pushes.

(`readBody`, `replyFor`, `register`, `push`, `putStatus`,
`packages/server/src/infrastructure/http-write.ts:318-332`, `393-407`,
`429-561`;
`putWave`, `putStatus`, `packages/server/src/application/write-model.ts:127-158`)

**The status write.** `PUT /api/v1/projects/<id>/status` is the second project
write, and every step above applies to it unchanged: same order, same
project-token authentication, same per-project allowance, same `PUT` body cap,
same decode, same two `422`s after it. It is stored at
`<dataDir>/status/<project>.json`, a directory of its own beside `snapshots/`
and **not** inside `snapshots/<project>/`, where a wave whose id is `status` — a
wave id the contract accepts — would have overwritten the document, or the
document the wave. Deleting a project removes the file with its waves, and does
not create the directory to remove from it (`StoredStatus`,
`packages/server/src/application/ports/store.ts:28-31`; `FileStore.putStatus`,
`…/file-store.ts:264-275`). A path naming a project that is not registered is
`401` for an unknown token and `403` `{"error":"wrong project"}` for another
project's token, as step 7 says for a wave; a document naming a project other
than the path's is the `422` above. A status write that finishes after its
project was deleted leaves a file nothing serves: the read route answers `404`
for a project the registry does not hold, and registering the id again removes
the file.

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
document, a new export, a stricter character rule and a `repo` that carries no
user or password, which is what a minor version of this package is for.

Contract **0.3.0** adds the notice document: a `decision` and an `event` record,
their validators, the `StateEntryRequest` validator, the per-decision bounds and
the per-project and per-decision caps shared with the server and client. The
binding text behind `textSha256` is produced here too, but the hashing itself is
done in `infrastructure/` by each package that needs it.

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

# A project that has pushed no status is a 404 here, like an unknown wave.
curl --fail --silent --show-error \
  --cacert ~/.config/waves/ca.crt \
  --user "viewer:$WAVES_VIEWER_TOKEN" \
  https://waves.example.com/api/v1/projects/apollo/status

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
