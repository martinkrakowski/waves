# Design: a decisions inbox on the status page

_Date: 2026-10-08 · Status: **stage 1 approved by the owner on 2026-10-08
("Approved, proceed with your recommendations", relayed by the fleet session):
sections 3 to 5 and 7, the read-only inbox. Stage 2 (section 6) is NOT approved
and is not to be built; whether to build it at all (W71) is decided after stage 1
has had a week of use, and W68 and W69 wait with it. W70 is decided (2026-10-10):
deleting a project deletes its decisions.** · Requirements:
`~/Projects/fleet/docs/planning/2026-10-08_decisions-inbox.md` (R1 to R12, F26 to
F28)._

_Revision 2 answered the review of the record and stage 1; revision 3 answers the
review of stage 2 (section 11). The reviewer's verdict: stage 1 may be approved
as it stands; stage 2 was not to be built as revision 2 wrote it._

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
- **Stage 2 does not close every case**, and section 6.3 says which: a session
  that controls what his screen shows (at any answer, and worst at enrolment),
  a session that removes his latest answer from the store, and a session that
  never reads the service. Each needs deliberate deception by an agent acting
  as him; none can happen by a session reading a file or calling an API.

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
   under it today. This design keeps that (W60), and the owner confirmed it on
   2026-10-10 (W70), because the alternative is a store that can never forget a
   project.

## 3. Decisions

| #       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **W52** | **A third document, `waves-notice/v1`,** beside `waves/v1` and `waves-status/v1`, in the contract package. A notice belongs to one project, has an id the project chooses (the lane id shape), and a `kind`: `decision` or `event`. It is not carried in a wave envelope and is not subject to wave retention or staleness.                                                                                                                                                                                                                                                                                                                                                          |
| **W53** | **A decision is revisions plus state entries, both append-only.** A write that differs in any field from the current revision makes revision `n + 1`; a write equal in every field is a no-op (`created: false`). The server never rewrites a stored revision. Each revision carries `textSha256`, computed by the server over the binding fields in the form section 4.3 defines, and returned to the writer.                                                                                                                                                                                                                                                                       |
| **W54** | **The binding fields** are the question, the shape, the options with their costs, the recommendation and reason, the hard-to-undo flag and reason, the commitments, who may decide, `appliesTo` and `actElsewhere`. Evidence links, references, the raiser and the change note are not binding: a revision that corrects a link has the same `textSha256` as the one before it, so an answer still stands. Every state entry names a `textSha256` and applies to revisions with that hash only (R9).                                                                                                                                                                                 |
| **W55** | **Three shapes:** `choice` (two or more options), `action` (something only he performs: no options, an act-elsewhere pointer is required), and `instruction` (a standing instruction in his words covering many items; `appliesTo` lists the projects).                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **W56** | **States** (section 4.2): `open`, `delegated`, `approved`, `declined`, `answered`, `withdrawn`, `superseded`. The current state is the last state entry whose `textSha256` is the current revision's; with none, the decision is `open`. A revision with new binding text therefore returns the decision to `open`, and the page shows the earlier answer as "answered an earlier text".                                                                                                                                                                                                                                                                                             |
| **W57** | **An answer has a source: `reported` or `signed`, and no other.** `approved`, `declined` and `answered` are refused with `source: session`. `reported` is written by a project session with the project token and must quote the owner's words from the terminal. `signed` is written by nobody's token: it is accepted only with a valid passkey assertion over that revision (W61). Stage 1 has only `reported`, and **a reported answer never takes a decision off the inbox by itself** (5.2): it is a session's claim, and the page keeps showing it as one.                                                                                                                    |
| **W58** | **An event is one immutable entry:** a `topic` (the stage shape, the project's own word: `relay`, `policy`, `alert`), one sentence, optional detail text, optional references, and a time. No states, no revisions, no answer. Events are listed newest first and capped per project (W59).                                                                                                                                                                                                                                                                                                                                                                                          |
| **W59** | **Bounds, so "never deleted" stays finite:** at most 500 decisions and 2000 events per project; 20 revisions per decision; 50 session-written state entries and, counted apart, 20 signed ones per decision, so entries a session writes can never use up the room for his answer; 8 options; the question at most 300 characters, every other text at most 2000. Past a bound the write is refused with the bound named; for events the oldest are dropped, which is the one place this design discards anything, and it says so in the response.                                                                                                                                   |
| **W60** | **Deleting a project deletes its notices** (admin token, as today). No project token can delete a notice or an entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **W61** | **Stage 2: an answer is a WebAuthn assertion whose challenge is derived from what is being answered and where it will stand.** The challenge is the SHA-256 of one JSON text with fixed keys in fixed order, serialised as 4.3 serialises: `{ "v": "waves-answer/v1", "project", "decision", "textSha256", "index", "verdict", "option", "words", "nonce" }`. `index` is the position the entry will take in the decision's state entries. User verification is required. The stored answer holds those values, the credential id, `authenticatorData`, `clientDataJSON` and the signature. A fixed-key object, not a concatenation, so no two different sets of values share bytes. |
| **W62** | **The owner's public keys are configuration, not data.** The server reads them from the file `WAVES_OWNER_KEYS_FILE` names (a Kubernetes Secret on midnight, created by the owner as he created the admin Secret). No route registers, replaces or removes a key, with any token. With no file, every answer route is `404`, as the write routes are without an admin token.                                                                                                                                                                                                                                                                                                         |
| **W63** | **Readers verify for themselves, from the text.** `waves decision read --signed` recomputes `textSha256` from the revision's own fields by 4.3 and ignores the stored hash; rebuilds the challenge from that, the entry's stored position and its stored values; and checks the signature against owner keys pinned outside the server (6.1). It rejects a signed entry whose signed `index` is not the position it is stored at. A signed entry that fails any of this is not an answer: exit 3.                                                                                                                                                                                    |
| **W64** | **The private key lives on a device no session reaches, and the ceremony starts on that device.** The owner's phone, or a hardware security key that needs a touch. Not a passkey synced to the laptop's keychain, where the laptop's own password can stand in for the fingerprint. And, for a phone: it is never linked to the laptop's browser as a nearby device, and a passkey prompt that appears on the phone when he did not press Answer on the phone is refused. That last part is his habit, not a control.                                                                                                                                                               |
| **W65** | **The answer route takes no bearer token and sets no cookie.** Each answer is one request carrying one assertion. There is no "signed-in" state for a session to borrow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **W66** | **A signed answer is announced where he will see it without the page:** the session that acts on it prints the question, the verdict and the recorded time in its terminal before it acts. This catches a session acting on an answer he gave to something else only when that session is honest. The detector that does not depend on the acting session is the export into `policy.md` by the fleet session and his reading of it. The recorded time is the server's word; it is not signed.                                                                                                                                                                                       |
| **W67** | **No new dependency.** Assertion checking is `node:crypto` (ES256 over `authenticatorData ‖ sha256(clientDataJSON)`), in `infrastructure/`. Keys are stored as SPKI, which the browser's `getPublicKey()` returns, so nothing parses CBOR.                                                                                                                                                                                                                                                                                                                                                                                                                                           |

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
  "raisedBy": "campaign-foundry session",
  "raisedAt": "2026-10-08T02:10:00Z",
  "refs": { "wave": "platform-and-tenancy-w07", "lane": "PT-9x", "pr": 731 }
}
```

- `decider` is `owner` or `delegated` (R2: who may decide).
- `hardToUndo.value` is `true`, `false` or `"partly"`, and `reason` is required
  whenever it is not `false`. The reason is the session's own sentence and is
  what the page shows; the page adds no wording of its own to it (test decision
  11's reason is "the deletion cannot be undone; the work is merged or
  obsolete", decision 7's is "a design change").
- `changeNote` is optional on revision 2 and later: one sentence saying what
  changed and why (test decision 6: "narrowed after the session reported a
  window"). It is not binding text.
- `commits` is the list of consequences an approval binds him to (test decision
  1 has three). It is binding text.
- `actElsewhere` is `{ "where": "session campaign-foundry-74", "what": "allow the
ruleset edit at its prompt" }` or a command only he runs. When it is set the
  page offers no answer control, in either stage (R8).
- `evidence[].href` is `https:` only; the page renders it as a link with
  `rel="noreferrer"` and never fetches it.

### 4.2 States and who writes them

| State        | Meaning                                                  | Source allowed         | Written by                          | Stage |
| ------------ | -------------------------------------------------------- | ---------------------- | ----------------------------------- | ----- |
| `open`       | waiting on him                                           | (no entry)             | implied by a revision with new text | 1     |
| `delegated`  | decided under delegation; names who and what; awaits him | `session`              | project token                       | 1     |
| `approved`   | he chose the recommended option, or said yes             | `reported` or `signed` | project token, or his signature     | 1 / 2 |
| `declined`   | he said no                                               | `reported` or `signed` | the same                            | 1 / 2 |
| `answered`   | he chose another option, or answered in his own words    | `reported` or `signed` | the same                            | 1 / 2 |
| `withdrawn`  | the question went away; a reason is required             | `session`              | project token                       | 1     |
| `superseded` | replaced by a later decision in the same project, named  | `session`              | project token                       | 1     |

A state entry is `{ state, revision, textSha256, expectedEntries, at, source, by,
words?, option?, reason?, supersededBy?, signature? }`. Rules the server
enforces, each a refusal that names the rule:

- **The entry pins what it is about.** `revision` and `textSha256` must be the
  current revision's, or the write is `409` with the current pair in the body.
  A session that reports his words therefore reports them against the text it
  read, and a text that changed in between is not answered by them.
- **One writer at a time.** `expectedEntries` is the number of state entries the
  writer read. If the stored count differs the write is `409`. Two sessions
  posting together cannot both succeed.
- **Source by state**, as the table says. `approved`, `declined` and `answered`
  with `source: session` are refused.
- `source: reported` requires `words`: the owner's own sentence, quoted.
  `delegated` requires `by` and `option` or `words`. `withdrawn` requires
  `reason`. `supersededBy` names an existing decision of the same project.
- A second `reported` entry on the same text is accepted: he does change his
  mind in the terminal (test decision 8). Both are kept and both are shown; the
  later one is current.
- After a `signed` entry on a text, no `reported` entry on that text is
  accepted. A second `signed` entry is; the last stands and both are kept.
- `withdrawn` and `superseded` are accepted over any state, including a signed
  answer. They never hide it: the card shows the answer, and beside it "the
  <project> session withdrew this question on <date>: <reason>". A session
  cannot remove his answer; it can only say the question no longer stands, and
  that statement is shown as the session's.

What these rules do not do: stop a session writing a false report. A session
with the project token can still claim "he said yes" with words he did not say.
That is true today of any session's terminal message. The page's part is to
keep such a claim in front of him, labelled, until he has had the chance to see
it (5.2).

### 4.3 The bytes behind `textSha256`

`textSha256` is the lower-case hex SHA-256 of the UTF-8 bytes of one JSON text
built from the revision, by a pure function in the contract package that server
and client both call:

- an object with exactly these keys in exactly this order: `question`, `shape`,
  `options`, `recommended`, `hardToUndo`, `commits`, `decider`, `appliesTo`,
  `actElsewhere`;
- `options` is the array as given, each element `{ key, text, cost }` in that
  key order; `recommended` is `{ option, reason }` or `null`; `hardToUndo` is
  `{ value, reason }` with `reason` `null` when absent; `actElsewhere` is
  `{ where, what }` or `null`; `commits` and `appliesTo` are arrays of strings
  in the given order;
- every string is Unicode NFC, with no leading or trailing white space (the
  validator refuses a string that is not already so, rather than repairing it);
- serialised with no white space between tokens, strings escaped as
  `JSON.stringify` escapes them.

Reordering the options is a change of text. So is moving, adding or removing the
`actElsewhere` pointer, because it decides whether the card can be answered at
all.

## 5. Stage 1

### 5.1 Routes

| Route                                                    | Token   | Body                | Success                                                |
| -------------------------------------------------------- | ------- | ------------------- | ------------------------------------------------------ |
| `PUT /api/v1/projects/<id>/decisions/<decision>`         | project | a decision revision | `200` `{ revision, textSha256, created }`              |
| `POST /api/v1/projects/<id>/decisions/<decision>/states` | project | one state entry     | `201` `{ index }`, or `409` with the current pair      |
| `POST /api/v1/projects/<id>/events`                      | project | one event           | `201` `{ id }`                                         |
| `GET /api/v1/projects/<id>/decisions`                    | none    |                     | heads, see below                                       |
| `GET /api/v1/projects/<id>/decisions/<decision>`         | none    |                     | every revision and state entry                         |
| `GET /api/v1/projects/<id>/events`                       | none    |                     | newest first, at most 200                              |
| `GET /api/v1/inbox`                                      | none    |                     | per project: the counts of 5.2 and its heads, by group |

A head is `{ project, id, question, shape, door, decider, revision, textSha256,
entries, state, source, at, actElsewhere }`: `source` is the current entry's, and
`entries` is the count a writer sends back as `expectedEntries`.

`GET …/projects/<id>/decisions` answers the project's own decisions and, marked
`from: "<other project>"`, every `instruction` of another project whose
`appliesTo` names this one (test decision 14). Any project can therefore put a
card on another project's tab; it is drawn with the raising project's name, and
it can be withdrawn only by the project that raised it.

The per-project write limiter is the existing one (one write a second per
project: `PROJECT_INTERVAL_MS`, `packages/server/src/application/limiters.ts`).
The optional viewer token of `docs/waves-v1.md` section 5.2, when the operator
has configured one, guards these reads as it guards every other read.

### 5.2 The page

**Four groups, and only he empties the first two.** Every project block on
`/inbox`, and the project page's tab, lists its decisions in this order:

1. **Waiting on you**: `open` and `delegated`.
2. **Reported as answered**: the current entry is a `reported` answer. The card
   reads "The <project> session reports you said: '…' on <date>" with the
   verdict beside it, and never "Approved" alone. It stays in this group for 14
   days from the entry, then moves to the project's history. Stage 1 has no way
   for him to confirm a report in the page; the 14 days are the time he has to
   see it and object in the terminal.
3. **Closed by a session**: `withdrawn` or `superseded` in the last 14 days,
   with the session's reason, and with any answer the entry covers shown beside
   it, not struck out of sight.
4. **Signed** (stage 2 only).

The glance count names its sources and never sums them: "3 waiting (1 one-way
door) · 2 reported · 1 closed by a session". `/api/v1/projects` gains
`decisions: { waiting, oneWay, reported, closed }` per project. A session that
writes a false report moves a card from group 1 to group 2 and changes "3
waiting" to "2 waiting · 1 reported"; it cannot make the card or the count
disappear.

- **A decision card** shows, in this order: the question; the door band; who may
  decide; the options with costs, the recommended one marked with its reason,
  or "No recommendation given"; the commitments, when there are any, under
  "Approving this commits you to"; the evidence links; who raised it and when;
  and "revision 2 of 2" with the change note and the earlier text one click
  away. An answer given to an earlier text stays on the card as "Answered an
  earlier text (revision 1): …".
- **The door band** is full width above the question, in words and not a colour
  alone, never abbreviated and never in a tooltip. `true` reads "ONE-WAY DOOR:
  <the stored reason>". `partly` reads "PARTLY UNDOABLE: <the stored reason>".
  `false` has no band. The page adds nothing to the reason.
- **`decider: delegated`, still `open`**: "May be decided under delegation; not
  decided yet." **`delegated`**: "Decided by <who> under delegation: <what>.
  Awaiting your confirmation." Both sort in group 1.
- **`actElsewhere`** cards read "Cannot be answered here. Act in: <where>:
  <what>", and a fixed line at the foot of `/inbox` says a session's own
  permission prompt can only be cleared in that session (R8).
- The fleet page's project rows and the project page gain the count and an
  Inbox tab. Events are a plain list on that tab, under the decisions.

### 5.3 The client

```sh
waves decision raise --file decision.json   # prints revision, textSha256, entries
waves decision read erase-user-prints-id    # prints the whole record as JSON
waves decision report erase-user-prints-id --revision 2 --text-sha256 <hex> \
  --entries 1 --state approved --words "Go with B"
waves decision state erase-user-prints-id --revision 2 --text-sha256 <hex> \
  --entries 2 --state withdrawn --reason "fixed another way"
waves event --topic relay --text "Round 4 sent to five sessions"
waves decisions export --since 2026-10-07   # Markdown for policy.md
```

`raise` is one call with one small file and the project's existing token (R11).
`report` and `state` take the pair and the count that `raise` or `read` printed;
a `409` prints the current ones and exits 5, and the session reads again before
it writes again.

Exit codes (R12):

| Command                             | `0`                                                                                                                                    | Other                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `read`                              | the record was read and printed. **It says nothing about an answer.**                                                                  | `1` the service could not be reached or answered an error; stdout is empty             |
| `read --signed`                     | the current text carries a signed answer that verified (stage 2); it is printed, followed by any session entry that sits over it (6.2) | `4` no signed answer on the current text; `3` a signature did not verify; `1` as above |
| `raise`, `report`, `state`, `event` | the write was stored                                                                                                                   | `1` not stored; one stderr line ending "ask in the terminal"; `5` a `409`              |

A session may act on the inbox only after `read --signed` exits 0. In stage 1
that never happens, so in stage 1 the inbox authorises nothing: it shows, and
the terminal answers. A session whose `raise` fails asks in the terminal as it
does today, and may raise again later; a failed `raise` is never a reason to
wait, and a failed `read` is never an answer.

`export` prints, per answered decision, the question, the answered revision's
full binding text, the verdict, the words, the time and the source. Reported
answers are printed under their own heading, every row beginning "reported, not
signed", in a table of their own; signed ones (stage 2) are printed with the
credential id in the shape `policy.md` uses for an owner decision. The fleet
session appends them (R6, F28) and does not copy a reported row into the owner's
decisions.

## 6. Stage 2: answering in the page

### 6.1 The credential

A passkey: an ES256 key pair made on the owner's phone or on a hardware security
key, for the relying party id `waves.midnight.lan` and the origin
`https://waves.midnight.lan`, both of which the server and the client check
exactly, with user verification required. The private key cannot be exported
from the device by anyone, the owner included. The public key (SPKI, base64) and
its credential id go into three places, each by the owner's own hand:

1. the server's `WAVES_OWNER_KEYS_FILE` (a Secret named `waves-owner-keys`). A
   session with cluster access can change this one; it decides only what the
   page accepts, never what a reader accepts;
2. `/etc/waves/owner-keys.json` on the laptop, owned by root, mode 644, which
   `waves decision read --signed` verifies against and which it refuses to read
   if it is not root-owned or is writable by anyone else. Writing it needs
   `sudo`, and `sudo` on the laptop asks for his password (checked 2026-10-08:
   `sudo -n true` answers "a password is required");
3. a copy in the fleet repository's registry, so a change is a diff.

**Enrolment.** A static page (`/enrol-key`) runs `navigator.credentials.create()`
and prints the public key and credential id for him to copy. It sends nothing to
the server. Enrolment is not finished until a test answer has verified: he
raises a test decision, answers it on the phone, and runs `waves decision read
--signed` from a clean checkout of a released client against the root-owned
pin. That proves the pinned key is one that signs when his device is asked. It
does **not** prove the device holds it: see T15.

### 6.2 The ceremony

1. On a decision card, on his phone, he picks a verdict (approve, decline,
   another option, or his own words) and presses Answer.
2. The page asks `POST …/decisions/<id>/nonce`. The server answers a nonce and
   the index the next state entry will take, and nothing else. Nonces are single
   use and live two minutes.
3. The page computes `textSha256` by 4.3 **from the revision it is showing** and
   builds the challenge of W61 itself. It shows a confirmation screen with the
   full binding text of that revision, the verdict and the commitments, then
   calls `navigator.credentials.get()`. The phone asks for his face or finger.
4. The page posts the assertion and the values to `…/answers`. The server
   recomputes the hash from its stored revision, rebuilds the challenge with the
   index the entry is about to take, checks the origin and `rpIdHash`, the
   user-verified flag, and the signature against a key from W62's file, and
   appends a `signed` state entry. If the text or the entry count moved in the
   meantime the challenge no longer matches and the answer is refused: he is
   shown the current card and asked again (R9).

A server whose challenge route was changed can no longer choose the bytes he
signs while an unchanged page shows something else. A changed page still can:
that is T10.

**Under a withdrawal.** When a session's `withdrawn` or `superseded` entry sits
over a signed answer on the same text, `read --signed` exits 0 and prints the
signed answer and, after it, the session's entry. A session's statement does not
change what his signature means; what to do about a withdrawn question he
already answered is for the session and him.

### 6.3 Threat cases

"Session" means an agent session running as the owner's user. It can read every
file he can, use his `gh`, `ssh m`, `kubectl` and Docker contexts, deploy this
server, edit the volume the store is on, and may be able to drive his laptop's
browser and screen. It cannot `sudo` on the laptop and cannot touch his phone.

| #   | Threat                                                                                                                                                                                                                                          | Outcome                                                      | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | A session reads a credential from the laptop, the lane host, a container or a k8s Secret                                                                                                                                                        | closed                                                       | There is none to read. The files and the Secret hold public keys.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| T2  | A session calls the answer route with its project token, the admin token, or no token                                                                                                                                                           | closed                                                       | The route accepts only a valid assertion (W65). No token is an answer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| T3  | A session replays an earlier signed answer: onto another decision, a later text, or **as a later entry of the same decision** (he signed approved, then declined; the session appends a copy of the approval by editing the store or deploying) | closed                                                       | The challenge binds project, decision, text, verdict, words and the entry's index (W61); a reader rejects a signed entry stored at any other position (W63). The nonce is only the live server's memory and is not what closes this.                                                                                                                                                                                                                                                                                                          |
| T4  | A session raises a decision, then changes its text after he answered                                                                                                                                                                            | closed                                                       | New text is a new hash; the answer stays on the old one and the decision is open again (W53, W56). The card and the head say "a signed answer exists on the previous text: declined", so a small rewording followed by a reported "approved" is not read as a fresh question.                                                                                                                                                                                                                                                                 |
| T5  | A session with deploy rights or store access makes the server accept or serve a forged or altered answer, or swaps a revision's text and keeps its hash                                                                                         | closed for an honest reader                                  | `read --signed` recomputes the hash from the text and checks the signature against the root-owned pin (W63). The page would show the forgery; an honest session reading through a released client would not act on it. For a session that edits its own client, T5 is T9.                                                                                                                                                                                                                                                                     |
| T6  | A session writes `approved` with `source: reported` and invented words                                                                                                                                                                          | detected, not prevented                                      | Stage 1's trust model unchanged. The page keeps it in "Reported as answered"; a signed answer on a text shuts reported ones out of it (4.2).                                                                                                                                                                                                                                                                                                                                                                                                  |
| T7  | A session steals a browser session or cookie                                                                                                                                                                                                    | closed                                                       | There is none (W65).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| T8  | A session drives the laptop's browser to press Answer, and the phone is asked over the nearby-device transport                                                                                                                                  | **reduced, rests on his habit**                              | The assertion still needs his face or finger on the phone. But a phone once linked to the laptop's browser can be asked from it, the phone shows the right name, and he touches. W64: never link it, and refuse a prompt he did not start on the phone. Whether iOS keeps such a link is unproven (6.4). It fails open if the passkey syncs to the laptop.                                                                                                                                                                                    |
| T9  | A session acts without reading the service, ignores a failed verification, or runs a client it changed                                                                                                                                          | not closable here                                            | Nothing in a status service can make a session wait. The fleet rulebook has to say that a decision raised in the inbox is acted on only after `read --signed` from a released client exits 0.                                                                                                                                                                                                                                                                                                                                                 |
| T10 | **A session controls what he sees**: it changes the served page (it can deploy), or serves a look-alike (T17), or changes the page in his laptop browser; shows him decision A and has his device sign decision B                               | **open**                                                     | The device shows "waves.midnight.lan", not the text. Answering on the phone removes the laptop-browser route only. Nothing in this design prevents it. Detection is not the acting session's notice (W66), because in this case the acting session is the deceiver: it is the fleet session's export into `policy.md` and his reading of an approval of B he does not remember.                                                                                                                                                               |
| T11 | A session replaces the pinned public key with one of its own, and signs                                                                                                                                                                         | closed for an honest reader on the laptop; open for the page | The reader's pin is root-owned (6.1). The server's Secret and the registry copy are writable by a session, so the page can be made to accept and show a forged answer; the registry diff and a banner for any credential id first seen in the last 7 days are detection.                                                                                                                                                                                                                                                                      |
| T12 | He approves by reflex: a prompt appears and he touches                                                                                                                                                                                          | reduced                                                      | The ceremony starts from his own press on the phone; the confirmation screen repeats the text; a card marked as a one-way door asks him to type the decision's id first; W68.                                                                                                                                                                                                                                                                                                                                                                 |
| T13 | Someone else on the network answers                                                                                                                                                                                                             | closed                                                       | They hold no key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| T14 | He loses the phone                                                                                                                                                                                                                              | recoverable                                                  | He edits the key files himself and enrols a new key. Old answers still verify against the old public key, kept in the files marked retired.                                                                                                                                                                                                                                                                                                                                                                                                   |
| T15 | **Enrolment is deceived**: a session deploys an enrolment page that makes his passkey but prints a key whose private half the session holds; he pins it himself, root-owned                                                                     | **open**                                                     | The test answer of 6.1 catches a page that only prints the wrong key, because his device's signature then fails against the pin. It does not catch a page that also signs the test with the session's key and discards his device's assertion: the page is the only thing that ever sees the device's answer. Limits: enrol once, from an image built at a commit the reviewer of this design has read, and compare the pinned key with the one the device returns on a second, independent enrolment page if one can be had (unproven, 6.4). |
| T16 | **A session removes his latest answer from the store**: he signed approved, then declined; the session deletes the decline, and the approval is again the last entry at its own index                                                           | **open**                                                     | The index stops a copy being added; it cannot show that something after it was taken away. Limits: the export into `policy.md` holds the decline; a reader could keep the highest entry count it has seen per decision and refuse a lower one, but that memory is a file a session can write.                                                                                                                                                                                                                                                 |
| T17 | A session mints a certificate for the page's name and serves a look-alike to the phone without deploying                                                                                                                                        | open, as T10                                                 | The home CA's private key is readable from the cluster with the access sessions have (checked 2026-10-08: the secret `midnight-ca` in `cert-manager` holds `tls.key`, and `kubectl auth can-i get secrets` there answers yes). It adds a route to T10, not a new outcome.                                                                                                                                                                                                                                                                     |

**What this design does not close: T9, T10, T15, T16, and the page's half of
T11.** Each requires an agent to set out to deceive him, in several steps, and
each but T9 leaves something another session or he can find afterwards. No
session can produce an approval by accident, by helpfulness, by reading a file
it should not have, or by being handed a credential, which is the failure R5
names. Against a session that sets out to deceive him while holding his user
account, his cluster and his deploy path, this design offers detection and not
prevention, and I do not think a status page on that same cluster can offer
more: prevention needs a screen and a server that no session can write to.

**W68 is not an answer to T10**, and revision 2 was wrong to offer it as one.
Whether a card is a one-way door is text the raising session writes, so a
session that means to deceive raises its decision as "not hard to undo". W68
limits honest error and reflex (T12) only.

| #       | Decision for the owner (open unless marked decided)                                                                                                                                                                                                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W68** | Are cards marked as one-way doors answerable in the page at all? Recommended: **no** in the first version of stage 2. This guards against reflex and honest mistakes, not against deception.                                                                                                                                              |
| **W69** | Phone passkey or hardware key (W64)? Recommended: the phone, because he reads the page there. If the trials of 6.4 show the phone can be asked from the laptop without his starting it, the hardware key.                                                                                                                                 |
| **W70** | Does deleting a project delete its decisions (W60)? **Decided by the owner, 2026-10-10: yes.** Deleting a project, which only the admin token can do, deletes that project's decisions, their history and its events from the service. It is a one-way door, chosen. Nothing is built for it: the service has behaved this way since #64. |
| **W71** | Given T10, T15 and T16, is stage 2 worth building at all on this cluster? Recommended: decide after the trial week of stage 1. If answering in the terminal turns out to be no burden once the inbox shows the queue, stage 2 buys little for what it leaves open.                                                                        |

### 6.4 Unproven, to be tried before stage 2 is built

- That the phone reaches `https://waves.midnight.lan` with the midnight CA
  trusted, and that iOS or Android WebAuthn accepts a `.lan` relying party id
  under a private CA. If it does not, stage 2 needs a public name and
  certificate for the page, which is a larger change.
- That a phone passkey can be created so that it does not sync to the laptop.
  If the platform will not allow that, W69's answer becomes the hardware key.
- That the phone's browser returns the public key from
  `AuthenticatorAttestationResponse.getPublicKey()`; without it enrolment has to
  parse the attestation, which W67 said nothing would.
- Whether a phone, once used from the laptop's browser as a nearby device, can
  be asked again without a new scan (T8).
- Whether the public key a device holds can be read by any means other than the
  enrolling page (T15).

## 7. The fourteen test decisions

| #   | Project          | Id (example)              | Shape       | Door: stored reason                                                     | Decider   | Stored                                                                                                    | Shown                                                                                       |
| --- | ---------------- | ------------------------- | ----------- | ----------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | hexagen-monaco   | `d12-document-owner`      | choice (3)  | true: "the key is in every row and route"                               | owner     | `approved`, reported, words "Go with option 3 for D-12"; three `commits`                                  | group 2 for 14 days: "reports you said …"; the band; the three commitments                  |
| 2   | hexagen-monaco   | `prod-postgres-home`      | choice (2)  | true                                                                    | owner     | `open`, `recommended: null`, `actElsewhere` "you set it up yourself"                                      | group 1; "No recommendation given"; "Cannot be answered here"                               |
| 3   | campaign-foundry | `erase-user-prints-id`    | choice (3)  | false                                                                   | delegated | `delegated`, by "fleet session", option b                                                                 | group 1: "Decided by fleet session under delegation: B. Awaiting your confirmation"         |
| 4   | campaign-foundry | `first-purge-org-apply`   | action      | true: "deletes an org's data"                                           | owner     | `open`, `actElsewhere` the command                                                                        | group 1; the band; "Cannot be answered here. You run: `yarn purge:org --apply`"             |
| 5   | campaign-foundry | `required-check-on-main`  | choice (2)  | false                                                                   | owner     | `open`, `actElsewhere` the session's prompt                                                               | group 1: "Act in: session campaign-foundry: allow the ruleset edit there"                   |
| 6   | gate-lock        | `give-up-bound`           | choice (3)  | false                                                                   | delegated | revision 1 `delegated` (A); revision 2 with a `changeNote`, new text, `delegated` again                   | group 1; "revision 2 of 2" and the note; "Decided an earlier text (revision 1): A"          |
| 7   | gate-lock        | `heartbeat-lock`          | choice (2)  | partly: "a design change"                                               | owner     | `open`, `recommended: null`, evidence issue 15                                                            | group 1; "PARTLY UNDOABLE: a design change"                                                 |
| 8   | fleet            | `test-db-switch-hold`     | choice (2)  | false                                                                   | owner     | one decision, recommended lift: `answered` option hold (reported), then `approved` option lift (reported) | group 2: the lift report current, the hold report under it as the earlier one               |
| 9   | fleet            | `offsite-backup-cost`     | choice (2)  | false                                                                   | owner     | `open`; the monthly cost is the yes option's `cost`                                                       | group 1                                                                                     |
| 10  | client-portal    | `rls-before-first-client` | choice (2)  | false                                                                   | owner     | `open`, evidence issue 71                                                                                 | group 1                                                                                     |
| 11  | client-portal    | `delete-three-branches`   | choice (2)  | partly: "the deletion cannot be undone; the work is merged or obsolete" | owner     | `open`                                                                                                    | group 1; "PARTLY UNDOABLE:" and that reason                                                 |
| 12  | waves            | `install-sync-agent`      | choice (2)  | false                                                                   | owner     | `open`, `recommended: null`; "a change to your machine" is the yes option's `cost`                        | group 1                                                                                     |
| 13  | fleet            | `backup-job-in-freeze`    | choice (2)  | true: "a production deployment"                                         | owner     | `open`, recommended no, reason "the standing freeze covers it"                                            | group 1, with its band. He has not answered it.                                             |
| 14  | fleet            | `clean-merged-worktrees`  | instruction | partly: "deleting; branches kept"                                       | owner     | `approved`, reported, his words quoted, `appliesTo` the five projects                                     | group 2 under fleet; on each named project's tab, marked "from fleet: standing instruction" |

Notes on the fixtures:

- **13 was wrong in revision 1**, and it was my reading, not the test data: the
  requirements say "recommended no; instructed inside the standing freeze", and
  I stored the recommendation as his answer. He gave none.
- **8 is one decision**, answered twice the same night, not two.
- The third commitment of decision 1 ("destroys a removed member's unpushed
  edits") is from the requirements' prose, line "An approval has consequences";
  the fixture needs the other two from the hexagen-monaco session.
- gate-lock and fleet are not registered projects today; the owner registers
  them as he does any project.

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
  stage 2 adds `decision read --signed` and its verification.
- **Fleet rulebook**: a session acts on the inbox only after `waves decision
read --signed` exits 0 (T9); a `raise` that fails is asked in the terminal
  instead; a reported answer is never copied into `policy.md` as the owner's
  decision; and R10 is the raising session's duty.

## 9. Each requirement

| Req | Answer                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Met: W52, W58. One record kind, two shapes.                                                                                                                                                                                                              |
| R2  | Met, with one field weaker than it reads: "who decided under delegation" is free text written with the project token (section 2, point 2).                                                                                                               |
| R3  | Met for the states. "Nothing is ever deleted" holds for decisions and their entries; events are capped (W59) and a deleted project takes its notices (W60, W70).                                                                                         |
| R4  | Met as revised: 5.2's four groups, counts by source. **Limit:** a session can still write a false report; it moves a card to "Reported as answered", it cannot remove it.                                                                                |
| R5  | Met for the credential (T1, T2, T3, T7, T13). **Not met in full**: T10, T15, T16 and the page's half of T11 are open; T8 rests on his habit; T9 is outside the service. W68 does not bear on any of them. W71 asks whether to build stage 2 here at all. |
| R6  | **Stage 2 only.** A signed entry holds the verdict, the text's hash (the text is the stored revision), the time and the credential id. A stage-1 report has no credential: it is attributable to a project token and exported as a report.               |
| R7  | Met for signed answers (W63, `read --signed`). Declined for reported ones: section 2, point 3.                                                                                                                                                           |
| R8  | Met: `actElsewhere`, and the fixed line on `/inbox`.                                                                                                                                                                                                     |
| R9  | Met for signed answers: W53, W54, W61, 4.3. For reported ones the pin (4.2) stops his words landing on changed text, but that the words are his is still the session's claim.                                                                            |
| R10 | Declined as a server guarantee: section 2, point 4. Size and character caps only.                                                                                                                                                                        |
| R11 | Met: `waves decision raise --file`.                                                                                                                                                                                                                      |
| R12 | Met as revised: the table in 5.3. Exit 0 from `read` is never an answer; a failed `raise` falls back to the terminal.                                                                                                                                    |

## 10. Lanes, once approved

Stage 1 is three lanes in order: the contract document and validator (high: it
is a public format); server store, models and routes; the page and the client
commands. Stage 2 is not planned in lanes until the trials of 6.4 have
answers and the trial week of the requirements' step 5 is over.

## 11. Review

### 11.1 The record and stage 1 (answered in revision 2)

Grok (`grok-4.7`, read-only), run by the fleet session on commit `1112449`,
sections 3, 4, 5, 7, 8, 9 and 10. In full:
`~/Projects/fleet/docs/planning/2026-10-08_decisions-inbox-review-stage1.md`.

| Finding                                                                                            | Answer                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BLOCKER: a session can make a decision leave the open list (`source: session`, no source on heads) | Changed: W57, 4.2 (source by state), 5.1 (source on heads), 5.2 (four groups, counts by source).                                                                                                             |
| The same finding: "does not reject a second reported entry"                                        | **Declined**, with the reason in 4.2: he does answer twice (test decision 8). Both entries are kept and shown; what the finding feared, a silent replacement, is closed by the groups and `expectedEntries`. |
| BLOCKER: `report` carries no revision or hash; concurrent writers both succeed; a withdrawal hides | Changed: 4.2 (the pin, `expectedEntries`, `409`), 5.2 group 3, 5.3.                                                                                                                                          |
| BLOCKER: the fixed gloss for `partly`                                                              | Changed: 4.1, 5.2. The band is the stored reason and nothing else.                                                                                                                                           |
| BLOCKER: test decision 13 stored as declined                                                       | Changed: section 7. My misreading.                                                                                                                                                                           |
| BLOCKER: exit 0 on `open` counts as an answer; `raise` has no behaviour when the service is down   | Changed: 5.3.                                                                                                                                                                                                |
| SHOULD: 8 is one decision; 2 lacks its pointer; 14's read path                                     | Changed: section 7, 5.1.                                                                                                                                                                                     |
| SHOULD: the canonical serialisation is not defined; which edits make a revision                    | Changed: 4.3, W53, W54. `actElsewhere` and `appliesTo` became binding text, which the finding did not ask for and its "can a pointer move under an answer" made necessary.                                   |
| SHOULD: stage-1 exports labelled as reports                                                        | Changed: 5.3.                                                                                                                                                                                                |
| NIT: no card copy for `decider: delegated` while `open`                                            | Changed: 5.2.                                                                                                                                                                                                |
| No change-note for decision 6                                                                      | Changed: `changeNote`, 4.1.                                                                                                                                                                                  |
| Section 9 says "Met" where it is partly met (R4, R6, R9, R12, and delegated under R2 and R3)       | Changed: section 9.                                                                                                                                                                                          |
| UNVERIFIED: the write limiter and the viewer token                                                 | Cited in 5.1.                                                                                                                                                                                                |

### 11.2 Stage 2 (answered in revision 3)

A read-only Fable `Plan` agent, arranged by the fleet session, on commit
`d2d0537`, section 6 with W54, W56 and 4.2. In full:
`~/Projects/fleet/docs/planning/2026-10-08_decisions-inbox-review-stage2.md`.

| #   | Finding                                                                                               | Answer                                                                                                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | BLOCKER: the challenge does not bind the entry's position; a copied signed entry becomes current      | Changed: W61 (`index`), W63, 6.2, T3. **And not enough alone**: an index cannot show that a later entry was removed. That is T16, new and open.                                                                                                      |
| 2   | BLOCKER (reasoning): W68 offered as the response to T10                                               | Changed: retracted in 6.3. W68 stays for reflex and honest error.                                                                                                                                                                                    |
| 3   | The page signs bytes the server chose                                                                 | Changed: 6.2 steps 2 and 3. The server returns a nonce and an index; the page derives the challenge from what it renders.                                                                                                                            |
| 4   | Does `read --signed` recompute the hash?                                                              | Changed: W63. It recomputes and ignores the stored hash.                                                                                                                                                                                             |
| 5   | A phone passkey is reachable from the laptop over the hybrid transport                                | Changed: W64, T8 is now "reduced, rests on his habit", and a trial in 6.4.                                                                                                                                                                           |
| 6   | Pin the readers' keys root-owned                                                                      | Changed: 6.1, T11. `sudo` on the laptop asks for a password (checked). The server's own copy stays writable by a session, so the page's half of T11 stays open.                                                                                      |
| 7   | `read --signed` under a withdrawal                                                                    | Changed: 6.2, 5.3. Exit 0, the withdrawal printed after the answer.                                                                                                                                                                                  |
| 8   | Enrolment can be deceived                                                                             | Changed in part: the test answer is added (6.1). **Declined as a closure**: a page that swaps the key can also forge the test with it, because only the page sees the device's answer. T15, open.                                                    |
| 9   | Missing cases: a direct edit of the store; the home CA's key                                          | Listed: T5 and T16 for the store; T17 for the CA key, which I checked is readable from the cluster.                                                                                                                                                  |
| 10  | The preimage is concatenated without length prefixes                                                  | Changed: W61 is a fixed-key object.                                                                                                                                                                                                                  |
| 11  | The signing time is the server's word                                                                 | Said: W66.                                                                                                                                                                                                                                           |
| 12  | A cosmetic revision over a signed decline; withdraw and re-raise for ever; 50 entries exhaust the cap | Changed: T4 (the flag on the card and head) and W59 (signed entries have their own cap). Linking a re-raised decision to an earlier one with the same text: **declined**, because one changed character defeats it and it would read as a guarantee. |
| —   | T10 names no detector; T5 is T9 for a session that edits its client                                   | Said: W66, T5, T10.                                                                                                                                                                                                                                  |
| —   | 6.4: add the phone's public-key retrieval and the exact relying-party id and origin                   | Changed: 6.4 and 6.1.                                                                                                                                                                                                                                |

What the review changed in my own view: revision 2 called T10 and T11 the two
open cases. Revision 3 has four, two of them (T15, T16) found by following the
reviewer's findings one step further than their "smallest change", and it adds
W71, which asks whether stage 2 should be built here at all.
