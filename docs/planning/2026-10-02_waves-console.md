# Plan: the waves console

Owner request, 2026-10-02: a new design for the web application, delivered as a
single-file HTML mock (`waves-console.html`), to be analysed, improved where it
can be, planned, built and deployed.

This plan **replaces wave B** of `2026-10-02_next-waves.md` (the "needs
attention" view): the console's rail and fleet page are that view, so its rule
and its route are built here instead (decision W4's rule stands; its lanes B1
and B2 are withdrawn). Wave C of that plan is untouched and still waits on W8.
Decisions continue that document's numbering.

The mock is not committed. It carries another project's lane names as sample
data, and this repository is public.

## 1. What the mock proposes

A dark, dense operator console in three levels, with one idea running through
it: the service is a **witness**. It shows what a lane reported beside what the
last push could derive, and it flags the gap instead of resolving it.

- **Shell.** A left rail (brand, project list, attention counters, legend), a
  sticky top bar with breadcrumbs and a freshness pill.
- **Fleet** (`/`). Six counters, a card per project, a panel of open
  disagreements.
- **Project** (`/p/<id>`), optionally pinned to one wave (`/p/<id>/w/<wave>`).
  Counters; a stale banner; a disagreements panel; a seat roll-up; a stage rail;
  a wave strip; a toolbar of signal chips, two selects and a search box; one
  lane table across every wave of the project.
- **Lane drawer.** Opens from a row: the disagreements, a key/value summary, a
  reported-versus-derived table, links out.
- **Copy orchestrator digest.** One button that puts a plain-text summary of
  the scope on the clipboard.

## 2. Analysis

### 2.1 What to keep

The witness framing; the three levels; lanes across waves in one filterable
table; reported and derived side by side; the stale banner that says _why_
liveness is unknown; the digest; the "N shown" count beside the toolbar;
keyboard affordances (`/` focuses search, `Esc` closes the drawer).

### 2.2 What cannot ship as drawn

| in the mock                                                                                           | why not                                                                                                                                                                                                                                                                                                                                                                                                           | what the plan does                                                                        |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Inline `<style>`, inline `style=""`, an inline `<script>`                                             | The service's CSP is `default-src 'none'; script-src 'self'; style-src 'self'` (`http-security.ts:5-6`), which blocks all three, and loosening it on a page that renders other projects' strings is not on offer. A style set from script is not blocked by the CSP; it is blocked by this repository's own test, which refuses a `style` attribute on any node (`__tests__/ui/helpers.ts`, `BANNED_ATTRIBUTES`). | Stylesheets and ES modules served from `public/`, as today. A bar is a `<meter>`.         |
| Google Fonts (IBM Plex)                                                                               | Blocked by the same CSP (no `font-src`, no foreign `style-src`), and it would make every viewer's browser call a third party.                                                                                                                                                                                                                                                                                     | W10: system font stacks. Self-hosting the fonts is a candidate, not a lane.               |
| `innerHTML` with an `esc()` helper                                                                    | ESLint bans HTML sinks in `public/`; every node is built by `dom.js` with `textContent`. An escape helper is one forgotten call away from stored XSS.                                                                                                                                                                                                                                                             | Every view is built through `dom.js`. Its attribute table grows by a closed list (K3).    |
| Hash routes (`#/p/…`)                                                                                 | The server already serves the page on `/` and `/p/<id>`, and a path is what a link in a chat message or a digest should carry.                                                                                                                                                                                                                                                                                    | W11: path routes, with `/p/<id>/w/<wave>` added to the server's index route.              |
| Role, vendor and model columns                                                                        | The contract has one `seat` string and an open `stage` vocabulary (`^[a-z][a-z-]{0,31}$`). "Role" is one project's mapping of its own stages; vendor and model are one project's way of writing a seat.                                                                                                                                                                                                           | W12: the console shows `stage` and `seat` as pushed.                                      |
| "Quota" signal, wave "focus", "repo push 17m", "transcribed / reconstructed"                          | None of these is a field of `waves/v1`. Two are artefacts of the mock's sample data.                                                                                                                                                                                                                                                                                                                              | Dropped. Signals are the attention reasons of W4, which are computable from the envelope. |
| "PR in detail" against "PR column"                                                                    | The contract already has both sides as fields: `reported.pr` and `derived.pr.number`. Reading a PR number out of free-form `detail` is inference.                                                                                                                                                                                                                                                                 | The table and the drawer compare `reported.pr` with `derived.pr`.                         |
| Legend text about ports 4317, 3000 and 3001; the `yarn wave:status` pill                              | That describes campaign-foundry's local page, not this service.                                                                                                                                                                                                                                                                                                                                                   | Dropped.                                                                                  |
| One fetch per wave to fill the project table                                                          | Twelve waves means twelve detail requests every ten seconds, per open tab.                                                                                                                                                                                                                                                                                                                                        | W9: one project-lanes route.                                                              |
| Clickable `<tr>`; a `<div>` drawer; chips with no pressed state; `--faint` text at about 3:1 contrast | Not reachable by keyboard, no focus management, state carried by colour alone, small text below WCAG AA.                                                                                                                                                                                                                                                                                                          | W14: accessibility is part of each lane's definition of done.                             |
| Full re-render on every keystroke, refocusing the search box by hand                                  | Loses the caret and scroll position, and would fight the ten-second refresh.                                                                                                                                                                                                                                                                                                                                      | Filters live in the URL; a refresh or a keystroke redraws the table body only.            |

### 2.3 What the mock leaves out and the current page has

These stay: the offline note that keeps the last good data on a failed load;
shape-checking every response before it is drawn (#14); the "show all" toggle
for waves past retention; the viewer-token guard; relative times with the exact
stamp in a title.

### 2.4 Improvements beyond the mock

- **Shareable state.** Reason, seat, stage, search and the open lane are query
  parameters, so a URL reproduces the view and the digest can carry it.
- **Signals are the attention reasons**, one rule in the server's domain layer.
  Two scopes use it and each is consistent with itself: on the fleet page the
  rail's counters and the attention panel both come from `/api/v1/attention`
  (72 hours, every project); on a project page the rail's counters, the chips
  and the table all come from the project-lanes response (that project's
  retained waves), so a chip's count is the number of rows it shows.
- **The stage rail is drawn from the data**: the stages present in the scope,
  in the order the pusher's lanes report them, not a hard-coded list of nine.
- **The digest is real data**, quoted as the pusher's words, and ends with the
  URL of the view it describes.
- **PR links** are composed only for a repository on `github.com`, through the
  existing https-only link helper.
- **Long seats wrap** (recorded in the review of #13).

## 3. Decisions

| id      | decision                                                                                                                                                                                                                                                                                                                                                                                                                                                | why                                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **W9**  | **Two new read routes and one new summary field.** `GET /api/v1/attention` (W4's rule), which also answers a count per project. `GET /api/v1/projects/<id>/lanes`: every lane of the project's retained waves in one response, each with its wave and its attention reasons, **without** `derived.log.tail`, `reported.detail` and the text of all but the first disagreement. `GET /api/v1/projects` gains `lanes`, a count taken from the wave heads. | The fleet page is two requests and the project table one. Tails, details and disagreement lists are the heavy fields and only the drawer reads them, so the drawer fetches the one wave it needs from the existing detail route. The summary stays as cheap as it is today: it reads heads, never wave files. All of it is additive: no envelope change, no contract package change. |
| **W10** | **System font stacks**: `ui-sans-serif, system-ui, sans-serif` and `ui-monospace, "SF Mono", Menlo, Consolas, monospace`.                                                                                                                                                                                                                                                                                                                               | No CSP change, no binary assets in the repository, no third-party request. The mock's layout does not depend on Plex's metrics.                                                                                                                                                                                                                                                      |
| **W11** | **Path routes**: `/`, `/p/<id>`, `/p/<id>/w/<wave>`; filters and the open lane in the query string. The server's index route gains the third path, with both segments held to the contract's id patterns as `/p/<id>` is today. The index route keeps ignoring the query string.                                                                                                                                                                        | Deep links survive a reload and can be pasted. This supersedes the fragment chosen for B2.                                                                                                                                                                                                                                                                                           |
| **W12** | **No project vocabulary in the console.** Stage and seat are shown as pushed; stages are not mapped to roles; seats are not split into vendor and model.                                                                                                                                                                                                                                                                                                | The service renders every project's waves. A mapping that is right for one pusher is wrong for the next.                                                                                                                                                                                                                                                                             |
| **W13** | **Dark by default, light by preference**: the mock's palette as CSS custom properties, with a `prefers-color-scheme: light` set, and `prefers-reduced-motion` honoured.                                                                                                                                                                                                                                                                                 | A status page gets left open on a wall and opened on a phone in daylight. Tokens make the second palette a dozen lines.                                                                                                                                                                                                                                                              |
| **W14** | **Accessibility is in each lane's definition of done**: every control is a `<button>`, `<a>`, `<input>` or `<select>`; the drawer is a `<dialog>` opened with `showModal()`; toggles carry `aria-pressed`; no state is carried by colour alone; text contrast is at least 4.5:1 in both palettes.                                                                                                                                                       | The mock is not operable by keyboard. A real browser's `<dialog>` traps focus and returns it; the test DOM does not, so `Esc`, the backdrop and focus return are also written and tested in the page's own code.                                                                                                                                                                     |
| **W15** | **The page stays one static bundle under the current CSP**: vanilla ES modules, every node through `dom.js`, no HTML sink, no new dependency, no build step.                                                                                                                                                                                                                                                                                            | The security posture of #8 is the reason this page can render untrusted strings. A redesign is not a reason to revisit it.                                                                                                                                                                                                                                                           |
| **W16** | **The old views stay until their replacement lands.** The shell lane keeps the current project list and wave panel working inside the new frame; each view lane then replaces one and deletes what it replaced.                                                                                                                                                                                                                                         | `main` is deployable after every merge, so a lane that stalls does not hold the others' work back.                                                                                                                                                                                                                                                                                   |
| **W17** | **All fetching, the offline note and the redraw stay in `app.js`.** A view is `render(model, handlers)`: it receives data that was already shape-checked and returns nodes.                                                                                                                                                                                                                                                                             | One place decides what a failed load looks like. It is also what lets the view lanes own separate files.                                                                                                                                                                                                                                                                             |

## 4. The read API (lanes K1, K2)

### 4.1 Attention reasons

The rule of `2026-10-02_next-waves.md` section 3, unchanged: `failed`,
`disagreement`, `checks`, `gate`, `exit`, `silent`; never for a lane whose
`derived.pr.state` is `merged` or `closed`. It is a pure function of one lane
and its wave's staleness, in `packages/server/src/domain/`.

The 72-hour window belongs to the cross-project route only. Inside a project
the reasons are computed for every retained wave, because there the reader has
chosen the scope.

### 4.2 `GET /api/v1/attention`

```
{ lanes: [{ project, wave, lane, seat?, reasons, receivedAt, stale, pr? }],
  projects: [{ id, attention }],
  truncated }
```

Waves received in the last 72 hours, newest receive first, at most 200 lanes;
`projects` carries the full count per registered project, whatever the cap cut.
It needs a route of its own: only `/api/v1/projects…` is parsed today
(`http-routes.ts:101`), so K1 adds a `Route` kind, its `ALLOWED` entry and a
`replyFor` case. Cost: wave heads for every project, then `getSnapshot` only for
the waves inside the window.

### 4.3 `GET /api/v1/projects/<id>/lanes`

```
{ project: { id, name, repo? },
  waves:  [{ wave, receivedAt, intervalSeconds, lanes, stale, retained }],
  lanes:  [{ wave, id, seat?, reported?: { stage, event, ts, pr?, round? },
             derived: { alive, exit?, gate?, pr?, diff?, planReview?, risk?,
                        log?: { bytes, mtimeMs, tail: boolean } },
             disagreements: <count>, disagreement?: <the first one>, reasons }],
  truncated }
```

- `waves` is the list the existing waves route answers, so the page needs no
  second request for the wave strip.
- `lanes` covers retained waves only, or every wave with `?all=1`. Newest wave
  first, in each wave's own order, at most 2 000 lanes and under the other two
  bounds of **Size** below; `truncated` says when more matched.
- `derived.alive` is `"unknown"` for a stale wave, as in the wave view.
- `log.tail` is a boolean: whether a tail was pushed. The text is not sent.
- **The query string.** The read path strips the query before routing today and
  every read route ignores it (`pathOf`, `http-routes.ts:83-86`). That stays
  true everywhere except here: `respond()` hands this one handler the raw
  query, which must be empty or exactly `all=1`, else `400`
  `{"error":"bad query"}`. The check runs after the viewer-token step, so an
  unauthenticated request is still a `401`; `HEAD` gets the same answer; the
  access log keeps logging the path only.
- **Size.** Three bounds, and a listing stops at whichever it reaches first: at
  most 2 000 rows, at most about 2 MiB of rows, and at most 200 waves read per
  request. `truncated` says when any of them left a matching row out, and a wave
  whose head says it holds no lanes is never read. The byte bound is there because
  the contract's field caps are in characters, not bytes: a lane at the cap
  answers in 4.8 MB filled with `"`, 6.5 MB filled with `中` and 11.4 MB filled
  with a lone surrogate over 2 000 lanes, so the byte bound answers 832, 627 and
  360 of them instead. The test builds each of those three, asserts the response
  stays under the byte bound, and asserts that no tail and no detail came with it.
- **Cost.** Wave heads, then `getSnapshot` for each wave it lists, which is a wave
  its head says has lanes and is within the per-request wave bound. The read model
  keeps each wave's computed rows in a map keyed by project and wave, at most 512
  waves and 10 000 rows, the entry used longest ago dropped first, so a poll that
  finds nothing new parses nothing while the waves it polls fit in the map. The
  read routes have no rate limit, which is why both of these are stated.
- `404` for an unknown project. Guarded by the viewer token, `no-store`, `405`
  with `Allow: GET, HEAD` otherwise.

### 4.4 `GET /api/v1/projects`

Each summary gains `lanes`, the number of lanes in the project's retained waves,
summed from the wave heads the route already reads. The page's shape check
(`present`, `public/projects.js`) admits unknown keys already; K1 makes `lanes`
a required number there.

## 5. Lanes

Naming: `K<n>-<what>`, wave `console-w01`. Every lane ends with the full gate
green on the Mac, its mutations replayed by the orchestrator, a pre-PR review,
and `docs/waves-v1.md` true.

**Order.** `K1`, then `K2` and `K3` in parallel, then `K4`, `K5`, `K6` one
after another. The three view lanes are sequential on purpose: each adds a
loader to `app.js`, a method to `api.js` and tags to the test helpers, and
those are single files.

```
K1 ──► K2 ──────────┐
  └──► K3 ──► K4 ──►├──► K5 ──► K6
```

### K1-attention-api (normal)

- **Scope.** The reasons rule as a pure function with a test per reason and per
  exclusion; `/api/v1/attention` as 4.2; `lanes` on the project summary as 4.4;
  the index route for `/p/<id>/w/<wave>` (W11), so no later lane can ship a
  link the server answers with a 404; §5 of `docs/waves-v1.md`.
- **Files.** `packages/server/src/domain/**`, `application/read-model.ts`,
  `infrastructure/http-routes.ts`, `infrastructure/http-server.ts`, their tests,
  the doc. On the page side, exactly: `public/projects.js`, `public/api.d.ts`
  (the summary type), `__tests__/ui/fixtures.ts` (the `projectCard` factory) and
  `__tests__/ui/projects-view.test.ts`.
- **Must not.** Change the envelope or the contract package; add a write; read
  anything but the store port; call `listSnapshots`.

### K2-project-lanes-api (normal), after K1

- **Scope.** `/api/v1/projects/<id>/lanes` as 4.3, with its query rule, its
  size test and its cache; the doc.
- **Files.** As K1's server files. Nothing under `public/` or `__tests__/ui/`.
- **Must not.** As K1. Send the text of a log tail (the boolean of 4.3 is sent), `reported.detail` or more than the
  first disagreement in the list. Let any other read route start reading the
  query.

### K3-shell (high), after K1, parallel with K2

- **Scope.**
  - `index.html`: the frame — rail, top bar, page area — with every node inside
    it still created by `dom.js`.
  - `tokens.css` (the palettes of W13, spacing, the two font stacks) and
    `shell.css`; `app.css` keeps the old views' rules until K4 and K5 delete
    them.
  - Routing: `/`, `/p/<id>`, `/p/<id>/w/<wave>`, and a parsed query: `reason`
    (one of the six), `stage` (the contract's stage pattern), `seat` (at most
    128 characters), `q` (at most 80), `lane` (the lane id pattern), `all`
    (`1`). Unknown parameters are ignored; a value that fails its rule is
    dropped, never echoed. A `seat` or `stage` that is not in the data selects
    nothing and never becomes an `<option>`. Navigation uses
    `history.pushState` and `popstate`.
  - The rail (project list from `/api/v1/projects`, the "show all" toggle moved
    here), breadcrumbs and the freshness pill.
  - `views/fleet.js` and `views/project.js` with the signature of W17, each
    wrapping the current view (the project list, the wave panel) so nothing is
    a placeholder and nothing is dead. `views/drawer.js` is not created here.
  - `dom.js`: the attribute table gains exactly `aria-pressed`, `aria-label`,
    `aria-current`, `aria-live`, `placeholder`, `value`, `max`, `name`, `for`,
    `id` and `data-key`. `id`, `for`, `name` and `data-key` take only values the
    app owns, never an API string; the test says so.
  - `eslint.config.js`, the `public/**` globals block only: `history`,
    `URLSearchParams`, `window` and `navigator` join the six allowed today.
  - `__tests__/ui/helpers.ts`: the closed tag set gains every tag K4, K5 and K6
    will create (`NAV`, `ASIDE`, `HEADER`, `ARTICLE`, `METER`, `INPUT`,
    `SELECT`, `OPTION`, `LABEL`, `DIALOG`, `DL`, `DT`, `DD`, `PRE`, `BUTTON`,
    as far as they are not there already), so those lanes do not each edit it.
- **Files.** `packages/server/public/**` except `projects.js` and `api.d.ts`'s
  summary type; `__tests__/ui/**` except `fixtures.ts`'s `projectCard` and
  `projects-view.test.ts`; `eslint.config.js` (that block).
- **Must not.** Add an HTML sink, an inline style or an eslint-disable; change
  the CSP or any server source; add a dependency or a font file; remove the
  offline note, the shape checks or the viewer-token behaviour.

### K4-fleet-view (high), after K3

- **Scope.** `views/fleet.js` and `fleet.css`: five counters (projects, waves, lanes,
  needing attention, stale projects; the mock's sixth, the age of the last
  repository push, is not something the service knows), a card per project, the attention panel
  from `/api/v1/attention` with each row a link to its lane
  (`/p/<project>/w/<wave>?lane=<id>`), the rail's attention counters, and a
  line saying the list was cut when `truncated` is true. One line each for an
  empty fleet and an empty attention list. `app.js` gains the attention load
  and its shape check; `api.js` one method. Removes the old project list view.
- **Files.** `public/views/fleet.js`, `public/fleet.css`, `public/projects.js`,
  `public/app.js`, `public/api.js`, their `.d.ts` files and tests,
  `__tests__/ui/fixtures.ts`, `__tests__/ui/xss.test.ts`.
- **Must not.** As K3. Build a link from an API field without the id-pattern
  check and `encodeURIComponent`.

### K5-project-view (high), after K2 and K4

- **Scope.** `views/project.js` and `project.css`, from the project-lanes
  route: counters; the stale banner, worded from `stale`, `receivedAt` and
  `intervalSeconds` and shown only when the scope is stale; the disagreements
  panel; the seat roll-up (top eight seats and "others", as `<meter>`s); the
  stage rail of 2.4; the wave strip with "all lanes"; the toolbar (reason chips
  with `aria-pressed` and counts, seat and stage selects built from the data,
  search, "N shown"); a line when `truncated` is true.
- **The lane table's columns:** lane (id, and its wave when the scope is the
  project) with the seat beneath, wrapping; reported (stage · event, age);
  alive (`yes`, `no` or `unknown`, with `exit` and whether a tail was pushed);
  PR (derived number, state and checks; the reported number beside it, marked,
  when the two differ); gate (exit and coverage); reasons as badges; the first
  disagreement and the count of the rest. Sorted by number of reasons, then id.
- A refresh or a filter change redraws the table body only and keeps focus,
  caret and scroll. `app.js` gains the lanes load and its shape check; `api.js`
  one method. Removes the old wave panel and lane table, keeping `drawableWave`,
  `detailList` and `logBlock`, which K6 uses.
- **Files.** `public/views/project.js`, `public/project.css`, `public/wave.js`,
  `public/lanes.js`, `public/app.js`, `public/api.js`, their `.d.ts` files and
  tests, `__tests__/ui/fixtures.ts`, `__tests__/ui/xss.test.ts`.
- **Must not.** As K3.

### K6-drawer-and-digest (high), after K5

- **Scope.**
  - `views/drawer.js` and `drawer.css`: a `<dialog>` in the frame, opened with
    `showModal()` from a row or from `?lane=`. `Esc`, the close button and a
    click on the backdrop close it, clear `lane` from the URL and return focus
    to the row; each of the three is handled and tested in the page's own code
    (W14). It fetches the lane's wave from the existing detail route,
    shape-checked by `drawableWave`, for the disagreements, the detail and the
    tail. Contents: reasons; every disagreement; the summary; the
    reported-versus-derived table (stage, alive, PR, exit); `detail` as a
    key/value list; the tail in a `<pre>`.
  - **The PR link.** Shown only when `httpsUrl(repo)` parses, its hostname is
    exactly `github.com`, its path is exactly two segments, and the number is a
    positive integer; built as `<repo>/pull/<n>` through `anchor`, so it
    carries `rel="noopener noreferrer"`.
  - `digest.js`: the digest as a pure function of the scope. Every string that
    came from a pusher has control characters and line breaks removed, is cut
    at 200 characters, and sits on a line of its own that begins with `> `
    under a heading saying these are the pusher's words; the counts and the
    view's URL are the page's own lines. The button writes it with
    `navigator.clipboard.writeText` and says so in an `aria-live` region, and
    says "copy failed" when the browser refuses.
- **Files.** `public/views/drawer.js`, `public/drawer.css`, `public/digest.js`,
  `public/app.js` (the dialog's wiring), `public/index.html` (the dialog
  element), their `.d.ts` files and tests, `__tests__/ui/xss.test.ts`.
- **Must not.** As K3. Put the tail, a detail value or a disagreement anywhere
  but `textContent`.

### Deploys

One after K4, one after K5, one after K6; K1, K2 and K3 ride along with the
first. Each runs the checks in `deploy/README.md` and one more: the page loads
with no CSP violation in the browser console.

## 6. Risk and review

K3 to K6 are high risk for the reason #8 was: they render strings other
projects chose. Each gets a separate brief review and a pre-PR review. Three
standing checks apply to all four:

- The XSS test's payload set goes through every field the lane renders, and
  through every query parameter the lane reads. K6 adds a payload with a line
  break and one that reads as an instruction, and asserts both arrive in the
  digest on a single quoted line.
- ESLint's ban on HTML sinks and on computed attribute names stays green with
  no disable comment.
- `assertNoInjectedMarkup` (`__tests__/ui/helpers.ts`) keeps walking the whole
  document after every render: it already refuses a `style` attribute and any
  tag outside its closed set.

The digest is the one output of this page that another program reads. Whatever
pastes it into a model is reading text a pusher partly wrote, which is why K6
quotes and flattens it rather than interleaving it with the page's own lines.

The read routes of K1 and K2 are normal risk, but they are reachable without a
token on a default install and have no rate limit; 4.2 and 4.3 state their cost
and K2's size test runs at the route's own cap.

## 7. Not in this plan

| candidate                                              | note                                                                                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-hosted IBM Plex                                   | Needs `font-src 'self'` in the CSP, `.woff2` in the static allow-list and the font files in the repository. A visual nicety; decide after the console is live. |
| A rate limit on the read routes                        | The write path has one; the read path never has. Worth its own decision now that two routes parse wave files.                                                  |
| Server-sent events                                     | The console polls every ten seconds, as today.                                                                                                                 |
| A per-project vocabulary (stage to role, seat parsing) | W12 rules it out of the service. A project that wants it can push `planReview` and `risk` strings, which the drawer shows.                                     |
| Notifications                                          | Still W7's open question.                                                                                                                                      |

## 8. Status, 2026-10-03

Every lane is merged and deployed; the live image is `2fcd47c`.

| lane                                       | PR  | merge     |
| ------------------------------------------ | --- | --------- |
| K1 the attention route                     | #18 | `4b715b9` |
| K3 the shell                               | #19 | `ab961ae` |
| K4 the fleet page                          | #21 | `c1e2229` |
| K2 the project lanes route                 | #20 | `3e7d961` |
| K5a the project page                       | #22 | `f4c7f92` |
| K5b counters, panels, filters, search      | #23 | `3877b21` |
| K7 the projects menu, the footer, the mark | #24 | `a7d1e91` |
| K6 the lane drawer and the digest          | #25 | `2fcd47c` |

**What changed from the plan.**

- K5 ran as two lanes: K5a, the page and its one request, and K5b, everything that filters it.
- K7 was not in the plan. It was the owner's request after K5b: the rail's project list became a drop-down in the top bar, the rail went, and a footer carries the legend, "read-only" and the status note. A three-wave mark sits beside the word `waves`.
- The drawer's `<dialog>` is made by `app.js` through `el()` and placed beside `#root`, not written into `index.html`, so every element on the page is still made by `dom.js`.

**Recorded and not fixed** — each is Low, and none was worth a fix round then.

- **Lanes route.** Its response's `waves` list was unbounded: about 9.7 MiB at 52 000 heads. **Fixed** by lane K8 — at most `MAX_LISTED_WAVES` (1 000) heads, with `wavesOmitted` saying how many were left out; the rows are not cut with them.
- **Attention route.** It had no per-request bound on waves, and its cache thrashed past 512 waves. **Fixed** by lane K8 — at most `MAX_ATTENTION_WAVES` (256) waves read per request, newest first, with `wavesOmitted` saying how many in-window waves were not read.
- **Focus.**
  - It jumps after a reason chip is activated.
  - Arrowing through a closed `select` pushes one history entry per step.
- **Status regions.** They are rebuilt on every draw, so some screen readers miss a change.
- **Counters.** They count the rows of a truncated listing, while the strip counts heads.
- **The menu.** It can flicker shut if the ten-second redraw lands in the one task between a click on the summary and its `toggle` event.
- **The drawer.** Its `close` guard reads the drawer's key when the event fires, and a browser fires `close` as a queued task. No real sequence reopens a drawer in that gap today.
