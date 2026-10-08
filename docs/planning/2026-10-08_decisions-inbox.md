# Design: a decisions inbox on the status page

_Date: 2026-10-08 · Status: **design, not approved; nothing is built from it yet** ·
Requirements: `~/Projects/fleet/docs/planning/2026-10-08_decisions-inbox.md` (R1 to
R12, F26 to F28), owner's "go" relayed by the fleet session on 2026-10-08._

Decisions continue the numbering of `2026-10-04_sync.md` (W51 was its last). This
document is step 1 of the requirements' six. Step 2 is a read-only review by a
model other than its author, with R5 first; step 3 is the owner's own approval.

## 1. Summary

- One new record kind, a **notice**, beside waves and the status document. A
  notice is either a `decision` or an `event`. Decisions carry what the owner is
  asked; events carry the fleet's relay rounds, policy changes and alerts. Neither
  is a lane, and neither lives in a wave (R1).
- A decision is **append-only**: a list of immutable revisions and a list of
  immutable state entries. Nothing is edited in place and nothing is deleted (R3,
  R9).
- **Stage 1** is a read-only inbox: `/inbox` for every project and a tab on each
  project page. Answers given in the terminal are recorded by the session as
  _reported_, and are shown as that (R4).
- **Stage 2** lets the owner answer in the page with a **passkey signature over
  the exact text he was shown**. There is no token, password or session cookie to
  find: an answer is a signature that only a device he physically touches can
  produce, and every reader checks it for itself (R5, R6, R7, R9).
- **Two cases stage 2 does not close**, said plainly in section 6.3: a session
  that controls what his screen shows, and a session that replaces the pinned
  public key everywhere. Both need deliberate deception by an agent acting as
  him; neither can happen by a session reading a file or calling an API.

## 2. Where this disagrees with the requirements

1. **R5 asks for a credential no session "can obtain from this machine". I can
   meet that for the credential, and not for the screen.** The private key never
   leaves the phone or security key, so there is nothing on the laptop, the lane
   host or a container to obtain. But a session running as his user on his laptop
   can drive his browser, and can deploy this server (the waves session does,
   with `deploy/deploy.sh`). Such a session cannot sign, yet it could show him
   text A while asking his device to sign text B. Section 6.3 says what limits
   that and what is left.
2. **"Decided under delegation" cannot be an authenticated fact.** The fleet
   session holds no token (its own rule), so a delegated decision is recorded by
   the project's session with the project's token and names who decided as free
   text. The page shows it as a claim awaiting confirmation, never as an answer.
3. **A terminal answer is a report, not an approval the service can vouch for.**
   Stage 1 has only these. They are stored and shown as `reported`, with his
   words quoted, and R7 ("act on an approval read from the service") applies
   only to signed answers. In stage 1 sessions keep acting on his word in the
   terminal, as today.
4. **R10 cannot be enforced by a validator.** The server can cap sizes and refuse
   control characters; it cannot know that a string is somebody's id. And reads
   of this service need no token: a decision is readable by anyone on the
   network the page is served to. The rule stays with the session that writes
   the decision, and the page says so beside the raise form's documentation.
5. **"Nothing is ever deleted" needs one exception named.** `DELETE
/api/v1/projects/<id>` with the admin token removes a project and everything
   under it today. This design keeps that (W60) and asks the owner to confirm it,
   because the alternative is a store that can never forget a project.

## 3. Decisions

| #       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W52** | **A third document, `waves-notice/v1`,** beside `waves/v1` and `waves-status/v1`, in the contract package. A notice belongs to one project, has an id the project chooses (the lane id shape), and a `kind`: `decision` or `event`. It is not carried in a wave envelope and is not subject to wave retention or staleness.                                                                                                                                                                                                                               |
| **W53** | **A decision is revisions plus state entries, both append-only.** A write with changed binding text makes revision `n + 1`; the server never rewrites a stored revision. Each revision carries `textSha256`, computed by the server over a canonical serialisation of the binding fields (W54), and returned to the writer.                                                                                                                                                                                                                               |
| **W54** | **The binding fields** are the question, the shape, the options with their costs, the recommendation and reason, the hard-to-undo flag and reason, the commitments, and who may decide. Evidence links, the raiser and the act-elsewhere pointer are not binding: correcting a link does not void an answer. An answer names one revision's `textSha256` and applies to that revision only (R9).                                                                                                                                                          |
| **W55** | **Three shapes:** `choice` (two or more options), `action` (something only he performs: no options, an act-elsewhere pointer is required), and `instruction` (a standing instruction in his words covering many items; `appliesTo` lists the projects).                                                                                                                                                                                                                                                                                                   |
| **W56** | **States** (section 4.2): `open`, `delegated`, `approved`, `declined`, `answered`, `withdrawn`, `superseded`. The current state is the last state entry that refers to the current revision; a new revision returns the decision to `open` and the page shows the earlier answer as "answered an earlier text".                                                                                                                                                                                                                                           |
| **W57** | **An answer has a source: `reported` or `signed`.** `reported` is written by a project session with the project token and quotes the owner's words from the terminal. `signed` is written by nobody's token: it is accepted only with a valid passkey assertion over that revision (W61). Stage 1 has only `reported`.                                                                                                                                                                                                                                    |
| **W58** | **An event is one immutable entry:** a `topic` (the stage shape, the project's own word: `relay`, `policy`, `alert`), one sentence, optional detail text, optional references, and a time. No states, no revisions, no answer. Events are listed newest first and capped per project (W59).                                                                                                                                                                                                                                                               |
| **W59** | **Bounds, so "never deleted" stays finite:** at most 500 decisions and 2000 events per project; 20 revisions and 50 state entries per decision; 8 options; the question at most 300 characters, every other text at most 2000. Past a bound the write is refused with the bound named; for events the oldest are dropped, which is the one place this design discards anything, and it says so in the response.                                                                                                                                           |
| **W60** | **Deleting a project deletes its notices** (admin token, as today). No project token can delete a notice or an entry.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **W61** | **Stage 2: an answer is a WebAuthn assertion whose challenge is derived from what is being answered:** `sha256("waves-answer/v1" ‖ project ‖ decision id ‖ revision textSha256 ‖ verdict ‖ sha256(chosen option or own words) ‖ server nonce)`. User verification is required. The stored answer holds the verdict, the words, the nonce, the credential id, `authenticatorData`, `clientDataJSON` and the signature, so anyone holding the public key can re-derive the challenge from the decision's own text and check it without trusting the server. |
| **W62** | **The owner's public keys are configuration, not data.** The server reads them from the file `WAVES_OWNER_KEYS_FILE` names (a Kubernetes Secret on midnight, created by the owner as he created the admin Secret). No route registers, replaces or removes a key, with any token. With no file, every answer route is `404`, as the write routes are without an admin token.                                                                                                                                                                              |
| **W63** | **Readers verify for themselves.** `waves decision read` checks a signed answer against the owner keys pinned in the client's own config directory (`owner-keys.json`, mode 600, written by the owner), not against anything the server says about its own keys. A signed answer that does not verify is reported as not answered, with exit 3.                                                                                                                                                                                                           |
| **W64** | **The private key lives on a device no session reaches:** the owner's phone, or a hardware security key that needs a touch. Not a passkey synced to the laptop's keychain, where the laptop's own password can stand in for the fingerprint.                                                                                                                                                                                                                                                                                                              |
| **W65** | **The answer route takes no bearer token and sets no cookie.** Each answer is one request carrying one assertion. There is no "signed-in" state for a session to borrow.                                                                                                                                                                                                                                                                                                                                                                                  |
| **W66** | **A signed answer is announced where he will see it without the page:** the session that acts on it prints the question, the verdict and the signing time in its terminal before it acts. This is detection for the two open cases of section 6.3, not a second approval.                                                                                                                                                                                                                                                                                 |
| **W67** | **No new dependency.** Assertion checking is `node:crypto` (ES256 over `authenticatorData ‖ sha256(clientDataJSON)`), in `infrastructure/`. Keys are stored as SPKI, which the browser's `getPublicKey()` returns, so nothing parses CBOR.                                                                                                                                                                                                                                                                                                                |

## 4. The record

### 4.1 A decision revision

```json
{
  "schema": "waves-notice/v1",
  "kind": "decision",
  "project": "campaign-foundry",
  "id": "erase-user-prints-id",
  "shape": "choice",
  "question": "May erase:user print the erased user's id when an erasure ends incomplete?",
  "options": [
    {
      "key": "a",
      "text": "Never print it",
      "cost": "An operator cannot tell which erasure to retry"
    },
    {
      "key": "b",
      "text": "Print it on failure only",
      "cost": "The id appears in one terminal"
    },
    { "key": "c", "text": "Store it", "cost": "A new record of an erased user" }
  ],
  "recommended": {
    "option": "b",
    "reason": "The operator needs it once, and it is stored nowhere"
  },
  "hardToUndo": { "value": false, "reason": "A message text" },
  "commits": [],
  "decider": "delegated",
  "appliesTo": [],
  "evidence": [{ "label": "PR 731", "href": "https://github.com/…/pull/731" }],
  "actElsewhere": null,
  "raisedBy": "campaign-foundry session",
  "raisedAt": "2026-10-08T02:10:00Z",
  "refs": { "wave": "platform-and-tenancy-w07", "lane": "PT-9x", "pr": 731 }
}
```

- `decider` is `owner` or `delegated` (R2: who may decide).
- `hardToUndo.value` is `true`, `false` or `"partly"`, and `reason` is required
  whenever it is not `false` (test decision 11: the deletion cannot be undone,
  nothing of value is lost).
- `commits` is the list of consequences an approval binds him to (test decision
  1 has three). It is binding text.
- `actElsewhere` is `{ "where": "session campaign-foundry-74", "what": "allow the
ruleset edit at its prompt" }` or a command only he runs. When it is set the
  page offers no answer control, in either stage (R8).
- `evidence[].href` is `https:` only; the page renders it as a link with
  `rel="noreferrer"` and never fetches it.

### 4.2 States and who writes them

| State        | Meaning                                                  | Written by                                  | Stage |
| ------------ | -------------------------------------------------------- | ------------------------------------------- | ----- |
| `open`       | waiting on him                                           | implied by a new revision                   | 1     |
| `delegated`  | decided under delegation; names who and what; awaits him | project token                               | 1     |
| `approved`   | he chose the recommended option, or said yes             | project token (`reported`) or his signature | 1 / 2 |
| `declined`   | he said no                                               | the same                                    | 1 / 2 |
| `answered`   | he chose another option, or answered in his own words    | the same                                    | 1 / 2 |
| `withdrawn`  | the question went away; a reason is required             | project token                               | 1     |
| `superseded` | replaced by a later decision in the same project, named  | project token                               | 1     |

A state entry is `{ state, revision, at, source, by, words?, option?, reason?,
supersededBy?, signature? }`. `source` is `session`, `reported` or `signed`.
Rules the server enforces:

- An entry names a revision that exists, and `supersededBy` an existing decision
  of the same project.
- `approved`, `declined` and `answered` with `source: reported` require `words`:
  the owner's own sentence, quoted.
- After a `signed` entry on a revision, no `reported` entry on that revision is
  accepted, and a second `signed` entry is accepted (he may change his mind);
  the last one stands and both are kept.
- `withdrawn` and `superseded` are accepted over any state, including a signed
  answer: the page then shows both, the answer struck through with the reason.
  A session cannot remove his answer, only say the question no longer stands.

## 5. Stage 1

### 5.1 Routes

| Route                                                    | Token   | Body                | Success                                    |
| -------------------------------------------------------- | ------- | ------------------- | ------------------------------------------ |
| `PUT /api/v1/projects/<id>/decisions/<decision>`         | project | a decision revision | `200` `{ revision, textSha256, created }`  |
| `POST /api/v1/projects/<id>/decisions/<decision>/states` | project | one state entry     | `201` `{ index }`                          |
| `POST /api/v1/projects/<id>/events`                      | project | one event           | `201` `{ id }`                             |
| `GET /api/v1/projects/<id>/decisions`                    | none    |                     | heads: id, question, state, door, revision |
| `GET /api/v1/projects/<id>/decisions/<decision>`         | none    |                     | every revision and state entry             |
| `GET /api/v1/projects/<id>/events`                       | none    |                     | newest first, at most 200                  |
| `GET /api/v1/inbox`                                      | none    |                     | per project: counts, and its open heads    |

A `PUT` whose binding text equals the current revision's makes no new revision
(`created: false`), so re-sending is safe. The existing per-project write limiter
applies. The viewer token of 5.2, when configured, guards these reads like every
other.

### 5.2 The page

- **`/inbox`**: one block per project that has anything open, ordered by one-way
  doors first, then by age. Each block's heading carries the count ("3 open, 1
  one-way door"). A project with nothing open is one line at the bottom.
- **A decision card** shows, in this order: the question; a door mark; who may
  decide; the options with costs, the recommended one marked with its reason;
  the commitments, when there are any, under "Approving this commits you to";
  the evidence links; who raised it and when; and "revision 2 of 2" with the
  earlier text one click away.
- **The one-way door mark** is a full-width band above the question, in words
  ("ONE-WAY DOOR: the key is in every row and route"), not a colour alone, and
  it is never abbreviated or moved into a tooltip. `partly` reads "CANNOT BE
  UNDONE, nothing of value lost: …".
- **`delegated`** cards read "Decided by <who> under delegation: <what>. Awaiting
  your confirmation", and sort with the open ones.
- **`actElsewhere`** cards read "Cannot be answered here. Act in: <where>:
  <what>", and a fixed line at the foot of `/inbox` says a session's own
  permission prompt can only be cleared in that session (R8).
- **Reported answers** read "Reported by the <project> session: he said '…'",
  and never "Approved" alone.
- The fleet header's project rows and the project page gain an "Inbox n" count
  and a tab; `/api/v1/projects` gains `decisions: { open, oneWay }` per project.
- Events are a plain list on the project page's new tab, under the decisions.

### 5.3 The client

```sh
waves decision raise --file decision.json        # prints revision and textSha256
waves decision state erase-user-prints-id --state withdrawn --reason "superseded by the fix"
waves decision report erase-user-prints-id --state approved --words "Go with B"
waves decision read erase-user-prints-id         # prints state as JSON
waves event --topic relay --text "Round 4 sent to five sessions"
waves decisions export --since 2026-10-07        # Markdown for policy.md
```

`raise` is one call with one small file and the project's existing token (R11).
`export` prints, per answered decision, the question, the answered revision's
full binding text, the verdict, the words, the time and the source (and in stage
2 the credential id), in the table shape `policy.md` uses; the fleet session
appends it (R6, F28).

`read` exit codes (R12): `0` a state was read and printed; `1` the service could
not be reached or answered an error, and stdout is empty; `3` a signed answer was
present and did not verify. A caller treats anything but `0` as "no answer".

## 6. Stage 2: answering in the page

### 6.1 The credential

A passkey: an ES256 key pair made on the owner's phone or on a hardware security
key, for the relying party `waves.midnight.lan`, with user verification required.
The private key cannot be exported from the device by anyone, the owner included.
The public key (SPKI, base64) and its credential id go into two places, both by
the owner's own hand:

1. the server's `WAVES_OWNER_KEYS_FILE` (a Secret named `waves-owner-keys`);
2. `~/.config/waves/owner-keys.json`, which `waves decision read` verifies
   against, and a copy in the fleet repository's registry so a change is a diff.

Enrolment is a static page (`/enrol-key`) that runs `navigator.credentials
.create()` and **prints** the public key and credential id for him to copy. It
sends nothing to the server and the server stores nothing from it.

### 6.2 The ceremony

1. On a decision card, on his phone, he picks a verdict (approve, decline,
   another option, or his own words) and presses Answer.
2. The page asks `POST …/decisions/<id>/challenge` with the revision's
   `textSha256`, the verdict and the words. The server answers a nonce and the
   challenge of W61. Nonces are single use and live two minutes.
3. The page shows a confirmation screen with the full binding text of that
   revision, the verdict, and the commitments, then calls
   `navigator.credentials.get()` with that challenge. The phone asks for his
   face or finger.
4. The page posts the assertion to `…/answers`. The server re-derives the
   challenge from **its stored revision**, checks the origin and `rpIdHash`,
   that the user-verified flag is set, and the signature against a key from
   W62's file. It appends a `signed` state entry. A revision that changed in the
   meantime no longer matches and the answer is refused: he is shown the new
   text and asked again (R9).

### 6.3 Threat cases

"Session" means an agent session running as the owner's user. It can read every
file he can, use his `gh`, `ssh m`, `kubectl` and Docker contexts, and may be able
to drive his laptop's browser and screen.

| #   | Threat                                                                                                                                                                         | Outcome                        | Why                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | A session reads a credential from the laptop, the lane host, a container or a k8s Secret                                                                                       | closed                         | There is none to read. The files and the Secret hold public keys.                                                                                                                                                                                                                                                                                                                                    |
| T2  | A session calls the answer route with its project token, the admin token, or no token                                                                                          | closed                         | The route accepts only a valid assertion (W65). No token is an answer.                                                                                                                                                                                                                                                                                                                               |
| T3  | A session replays an earlier signed answer onto another decision or a later revision                                                                                           | closed                         | The challenge binds project, decision, revision text, verdict, words and a single-use nonce (W61).                                                                                                                                                                                                                                                                                                   |
| T4  | A session raises a decision, then changes its text after he answered                                                                                                           | closed                         | New text is a new revision with a new `textSha256`; the answer stays on the old one and the decision is open again (W53, W56).                                                                                                                                                                                                                                                                       |
| T5  | A session with deploy rights changes the server to accept unsigned answers                                                                                                     | closed for readers that verify | `waves decision read` checks the signature against its own pinned key (W63). The page would show a forged answer; a session reading through the client would not act on it. A session that skips the client is T9.                                                                                                                                                                                   |
| T6  | A session writes a state entry `approved` with `source: reported` and invented words                                                                                           | detected, not prevented        | This is stage 1's trust model unchanged: a session can already claim "he said yes". The page labels it reported; signed answers on a revision shut reported ones out of it (4.2).                                                                                                                                                                                                                    |
| T7  | A session steals a browser session or cookie                                                                                                                                   | closed                         | There is none (W65).                                                                                                                                                                                                                                                                                                                                                                                 |
| T8  | A session drives the laptop's browser to press Answer                                                                                                                          | closed if W64 holds            | The assertion needs a touch or a face on a device the session cannot reach. It fails open if the passkey is synced to the laptop and the laptop accepts its password in place of the fingerprint: hence W64.                                                                                                                                                                                         |
| T9  | A session acts without reading the service at all, or ignores a failed verification                                                                                            | not closable here              | Nothing in a status service can make a session wait. The fleet rulebook has to say that a decision raised in the inbox is acted on only after `waves decision read` exits 0 with a signed answer.                                                                                                                                                                                                    |
| T10 | **A session controls what he sees**: it changes the served page (it can deploy) or the page in his laptop browser, shows him decision A and asks his device to sign decision B | **open**                       | The device shows "waves.midnight.lan", not the text. Limits: answering on the phone removes the laptop-browser route but not the changed-server route; the signed record says B, so W66's notice and the `policy.md` export show an approval of B he does not remember giving. That is detection after the fact. Prevention needs a display no session can write to, which this fleet does not have. |
| T11 | **A session replaces the pinned public key** in the server's Secret, in `owner-keys.json` and in the registry, with a key of its own, and signs                                | **open**                       | Every pin is a file his user can write. Limits: the registry copy makes it a visible diff; the page shows the credential id on every signed answer and a banner for any id first seen in the last 7 days. Detection, not prevention.                                                                                                                                                                 |
| T12 | He approves by reflex: a prompt appears and he touches                                                                                                                         | reduced                        | The ceremony starts only from his own press on the phone; the confirmation screen repeats the text; one-way doors require typing the decision's id before the device is asked.                                                                                                                                                                                                                       |
| T13 | Someone else on the network answers                                                                                                                                            | closed                         | They hold no key.                                                                                                                                                                                                                                                                                                                                                                                    |
| T14 | He loses the phone                                                                                                                                                             | recoverable                    | He edits the two key files himself and enrols a new key. Old answers still verify against the old public key, which is kept in the files marked retired.                                                                                                                                                                                                                                             |

**What I cannot close: T9, T10 and T11.** T10 and T11 both require an agent to
set out to deceive him, in several steps, leaving a signed record or a diff. No
session can produce an approval by accident, by helpfulness, by reading a file it
should not have, or by being handed a credential, which is the failure R5 names.
If the owner wants T10 closed for one-way doors, the honest answer is that
one-way doors stay answered in the terminal, where he reads the question from
the session that will act on it; the page would then show them and refuse to
take their answer. I recommend that for stage 2's first version (W68 below is
his to decide).

| #       | Open decision for the owner                                                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W68** | Are one-way doors answerable in the page at all? Recommended: **no** in the first version of stage 2; revisit after a month of two-way answers.       |
| **W69** | Phone passkey or hardware key (W64)? Recommended: the phone, because he reads the page there and the laptop browser is then not part of the ceremony. |
| **W70** | Does deleting a project delete its decisions (W60)? Recommended: yes, admin only, as today.                                                           |

### 6.4 Unproven, to be tried before stage 2 is built

- That the phone reaches `https://waves.midnight.lan` with the midnight CA
  trusted, and that iOS or Android WebAuthn accepts a `.lan` relying party id
  under a private CA. If it does not, stage 2 needs a public name and
  certificate for the page, which is a larger change.
- That a phone passkey can be created so that it does not sync to the laptop.
  If the platform will not allow that, W69's answer becomes the hardware key.

## 7. The fourteen test decisions

| #   | Project          | Id (example)              | Shape       | Door                          | Decider   | Stored state                                                              | Shown as                                                                           |
| --- | ---------------- | ------------------------- | ----------- | ----------------------------- | --------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | hexagen-monaco   | `d12-document-owner`      | choice (3)  | true                          | owner     | `approved`, reported, words "Go with option 3 for D-12"                   | answered list; door band; three commitments under "commits you to"                 |
| 2   | hexagen-monaco   | `prod-postgres-home`      | choice (2)  | true                          | owner     | `open`, no recommendation                                                 | top of its project; "No recommendation given"                                      |
| 3   | campaign-foundry | `erase-user-prints-id`    | choice (3)  | false                         | delegated | `delegated`, by "fleet session", option b                                 | "Decided under delegation: B. Awaiting your confirmation"                          |
| 4   | campaign-foundry | `first-purge-org-apply`   | action      | true                          | owner     | `open`, `actElsewhere` the command                                        | door band; "Cannot be answered here. You run: `yarn purge:org --apply`"            |
| 5   | campaign-foundry | `required-check-on-main`  | choice (2)  | false                         | owner     | `open`, `actElsewhere` the session's prompt                               | "Blocked in session campaign-foundry: allow the ruleset edit there"                |
| 6   | gate-lock        | `give-up-bound`           | choice (3)  | false                         | delegated | revision 1 `delegated` (A); revision 2 (narrowed) `delegated`             | "revision 2 of 2"; revision 1 and its decision one click away                      |
| 7   | gate-lock        | `heartbeat-lock`          | choice (2)  | partly ("a design change")    | owner     | `open`, evidence issue 15                                                 | open, no recommendation                                                            |
| 8   | fleet            | `test-db-switch-hold`     | choice (2)  | false                         | owner     | `approved` (hold), then `superseded` by `test-db-switch-lift`, `approved` | the later card answered; the earlier one struck through, naming its successor      |
| 9   | fleet            | `offsite-backup-cost`     | choice (2)  | false, reason "costs monthly" | owner     | `open`                                                                    | open; the cost shown under the yes option                                          |
| 10  | client-portal    | `rls-before-first-client` | choice (2)  | false                         | owner     | `open`, evidence issue 71                                                 | open                                                                               |
| 11  | client-portal    | `delete-three-branches`   | choice (2)  | partly                        | owner     | `open`                                                                    | "CANNOT BE UNDONE, nothing of value lost: merged or obsolete"                      |
| 12  | waves            | `install-sync-agent`      | choice (2)  | false                         | owner     | `open`, no recommendation                                                 | open; "a change to your machine" as the yes option's cost                          |
| 13  | fleet            | `backup-job-in-freeze`    | choice (2)  | true ("a production deploy")  | owner     | `declined`, reported, words quoted                                        | answered list                                                                      |
| 14  | fleet            | `clean-merged-worktrees`  | instruction | partly                        | owner     | `approved`, reported, words quoted, `appliesTo` every project             | on `/inbox` under fleet, and on each named project's tab as "standing instruction" |

What the table needed that the first draft of the record did not have: `partly`
for the door (7, 11, 14), `appliesTo` (14), `actElsewhere` on a `choice` as well
as an `action` (5), and an empty `recommended` (2, 7, 12). gate-lock and fleet
are not registered projects today; the owner registers them as he does any
project.

## 8. What changes where

- **`docs/waves-v1.md`**: a new section "The notice document" after "The project
  status document" (fields, bounds, the canonical serialisation behind
  `textSha256`); the read and write route tables; stage 2 adds a section "Owner
  keys and signed answers" beside 5.2, and `WAVES_OWNER_KEYS_FILE` beside the
  token files.
- **Contract** (minor version): the notice types, their validator, and the pure
  function that serialises binding text and derives a challenge, so server and
  client cannot drift.
- **Server**: store port methods for decisions and events (append and read
  only); read and write models; the routes; `public/` gains the inbox view.
  Stage 2 adds the key file reader, the challenge and answer routes and the
  assertion check.
- **Client** (minor version): the `decision`, `decisions` and `event` commands;
  stage 2 adds verification to `decision read`.
- **Fleet rulebook**: the T9 sentence, and that R10 is the raising session's
  duty.

## 9. Each requirement

| Req | Answer                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Met: W52, W58. One record kind, two shapes.                                                                                                       |
| R2  | Met: 4.1. "History of its states" is the state entries.                                                                                           |
| R3  | Met: W56, 4.2. "Never deleted" holds for decisions; events are capped (W59) and a deleted project takes its notices (W60).                        |
| R4  | Met: section 5.                                                                                                                                   |
| R5  | Met for the credential (T1, T2, T7, T8, T13). **Not met in full**: T10 and T11 are open, T9 is outside the service. W68 is the recommended limit. |
| R6  | Met: a signed entry holds the verdict, the revision's hash (the text is the stored revision), the time and the credential id; `decisions export`. |
| R7  | Met for signed answers (W63). Declined for reported ones: section 2, point 3.                                                                     |
| R8  | Met: `actElsewhere`, and the fixed line on `/inbox`.                                                                                              |
| R9  | Met: W53, W54, W61, and step 4 of 6.2.                                                                                                            |
| R10 | Declined as a server guarantee: section 2, point 4. Size and character caps only.                                                                 |
| R11 | Met: `waves decision raise --file`.                                                                                                               |
| R12 | Met: the exit codes of 5.3.                                                                                                                       |

## 10. Lanes, once approved

Stage 1 is three lanes in order: the contract document and validator (high: it
is a public format); server store, models and routes; the page and the client
commands. Stage 2 is not planned in lanes until the two trials of 6.4 have
answers and the trial week of the requirements' step 5 is over.

## 11. Review

None yet. Step 2 of the requirements: one read-only pass by a model other than
this document's author (Claude Opus 5.5), with R5 and section 6.3 first.
