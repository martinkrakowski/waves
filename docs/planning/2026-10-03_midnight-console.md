# Plan: the midnight console redesign

Owner request, 2026-10-03: update the UI to match a new inspiration — a single
HTML mock, "waves — midnight console", built with React, framer-motion and
Babel from CDNs, on invented demo data — and delegate the implementation to
midnight.

The mock is not committed: it is a design reference, and its demo data names
other people's projects.

Decisions continue the numbering of `2026-10-02_enrollment.md` (W29 was its
last). The owner settled three of them on 2026-10-03: self-hosted fonts (W31), a
light variant kept beside the dark default (W32), and a ring of merged lanes in
place of the mock's health ring (W36).

## 1. What the mock proposes

A darker, more atmospheric operator console on one page.

- **Look.** A near-black ground (`#05070d`) with soft cyan and violet radial
  glows and a faint blueprint grid fading out downward; glass cards (`1px`
  hairline borders, a slight top-lit gradient, 18px radius); a cyan, emerald,
  amber, rose and violet palette; Inter for text, Space Grotesk for display,
  JetBrains Mono for ids and numbers.
- **Top bar.** Sticky and blurred: a brand of four animated wave bars beside
  "waves" and a "console" tag; a "synced Ns ago" pill; a ticking clock; a refresh
  button.
- **Hero.** A live eyebrow ("midnight console · live" with a pinging dot), a
  large headline ("Every wave, accounted for."), a sentence of live counts, three
  chips (running, blocked, queued), and an animated three-layer wave field along
  its bottom edge that drifts and follows the pointer.
- **Stats.** Four cards with an icon each, a big counted-up number and a
  caption: projects, waves in flight, live lanes, needs attention.
- **Projects.** Tabs (All, In flight, Flagged, Completed) with counts, a search
  box, and one row per project: a status dot, the name with an "N open" flag,
  `repo · branch · id`, a segmented bar with one segment per wave coloured by its
  state, a caption ("3/6 merged · W4 71% running"), a lane count, a health ring,
  and a chevron that expands the row into one chip per wave.
- **Needs attention.** A triage list, "sorted by severity": each card has a
  coloured left edge, a kind pill, a "high sev" tag, an age, a title, a
  description, project and ref chips, and "Review", "Resolve", "Apply &
  dispatch" and "Open diff" buttons, a toast with "Undo", and an "all clear"
  state.
- **Next auto-wave.** A countdown card ("Waves spawn every 30 minutes").
- **Footer.** A legend of the six states and a line of totals.

## 2. Analysis

### 2.1 What to keep

The look as a whole: the ground, the glow and the grid, the glass cards, the
palette, the three typefaces, the sticky blurred top bar with the wave-bar mark,
a compact live hero with its wave field, the stat cards, the project rows with a
per-wave segmented bar that expands into wave chips, the attention cards with
their coloured edge and kind pill, the legend footer, and the ambient motion (the
live dot, the running sheen, the drifting waves) under `prefers-reduced-motion`.

### 2.2 What cannot ship as drawn

| In the mock                                                                          | Why not                                                                                                                                                                                                                                                          | Instead                                                                                                                                                                     |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React, framer-motion and Babel from `unpkg`; Google Fonts                            | The CSP (`http-security.ts:5-6`) is `default-src 'none'` with `script-src`, `style-src`, `connect-src` and `img-src` limited to `'self'`: no CDN can load, there is no inline script and no runtime transpiler. And the page builds every node through `dom.js`. | Vanilla modules as today, motion in CSS keyframes, fonts self-hosted (W31).                                                                                                 |
| Entrance animations (stagger, rise, word blur, count-up)                             | `draw()` replaces the children of `#root` on every ten-second refresh and every navigation: they would replay every ten seconds.                                                                                                                                 | Entrance motion only on the first paint with data (W34); ambient motion is CSS-only and infinite; no JavaScript count-up.                                                   |
| A health ring per project                                                            | There is no health metric; the number is invented.                                                                                                                                                                                                               | A ring of merged lanes over all lanes in the project's recent waves, labelled "merged" (W36).                                                                               |
| Wave states `queued` and `blocked`, a `pct` progress fill, an ETA                    | No pusher reports a queue, a percentage or an ETA.                                                                                                                                                                                                               | The derived wave state of W35; no fill, no ETA.                                                                                                                             |
| "Resolve", "Apply & dispatch", "Open diff", a toast with "Undo", "N resolved today"  | The service is a witness: the page writes nothing, and an attention item clears when the lanes stop asking for it.                                                                                                                                               | Each attention card links to its lane (the drawer), and to its pull request when the drawer's rule allows one (a `github.com` repo and a reported PR number). Nothing else. |
| "Sorted by severity" over an invented severity                                       | Severity is not in the data.                                                                                                                                                                                                                                     | A severity derived from the reasons (W37), then recency.                                                                                                                    |
| The "next auto-wave" countdown                                                       | Nothing in waves schedules waves.                                                                                                                                                                                                                                | The side card shows each project's status from wave C (backlog state, PR rows unread), which is real.                                                                       |
| A clock ticking every second                                                         | A per-second timer for decoration.                                                                                                                                                                                                                               | Dropped. The sync pill shows the clock time of the last successful load (W41).                                                                                              |
| `--faint: #5d6a85` text on `#05070d`                                                 | About 3.7:1, below WCAG AA — rejected once already (console plan §2.2, W14).                                                                                                                                                                                     | A lifted faint token that reaches 4.5:1 (W33).                                                                                                                              |
| A large hero (72px top, 84px bottom padding)                                         | On a console polled every ten seconds, it pushes the fleet below the fold.                                                                                                                                                                                       | A compact hero on the fleet route only; the project page keeps its lede (W38).                                                                                              |
| Clickable `div` rows with `role="button"`; the project name inside the clickable row | A native disclosure needs no script and no ARIA; a link inside a `summary` is interactive content inside a button.                                                                                                                                               | `details`/`summary` rows with the project link outside the summary (W39).                                                                                                   |
| Wave state carried by colour alone                                                   | W14 forbids state by colour alone.                                                                                                                                                                                                                               | Every segment and chip says its state in text (a visually hidden word on a segment, the word on a chip).                                                                    |

### 2.3 What the current page has and the mock leaves out

The project page, the lane drawer, the copy digest, the projects menu, the
breadcrumb, the status panel (wave C): all kept and re-skinned (lane U4), not
redesigned. The fleet's "stale projects" counter is kept as the caption of the
projects card: staleness is the witness signal (W4).

## 3. Decisions

| #       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W30** | **No new runtime dependency.** Vanilla ES modules and CSS, as today. Every SVG (the brand bars, the wave field, the stat icons, the rings) is built with `createElementNS` and literal attribute names, as `logo.js` is. The only values computed into an SVG attribute are numbers the page itself formats after `Number.isFinite` (a ring's dash length from `merged / lanes`); no API string reaches an SVG attribute. `ALLOWED_TAGS` (`__tests__/ui/helpers.ts`) holds `svg` and `path`; lane U1b adds every further SVG tag the redesign uses (`circle`, `g`, `rect`, `defs`, `linearGradient`, `stop`) once.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **W31** | **Self-hosted fonts** (owner). Inter, Space Grotesk and JetBrains Mono, each under the SIL Open Font License 1.1 (the licence text is committed beside the files), as Latin-subset variable `woff2` files (one per family, three in all), with `font-display: swap`. The CSP gains `font-src 'self'`, appended after `img-src 'self'`, and the static allow-list gains `.woff2` (`font/woff2`). The CSP is pinned whole in `__tests__/http-api.test.ts`, `__tests__/http-static.test.ts` and `docs/waves-v1.md` §5; the other tests pin only its prefix. `Dockerfile` copies `packages/server` whole, so the files ship. Fonts from the service's own origin and nothing else: the one security-relevant change of this plan. Supersedes the console plan's W10 (system fonts) and closes its §7 row "Self-hosted IBM Plex".                                                                                                                                                                                                                                                                                                                          |
| **W32** | **Dark by default, a light variant kept** (owner). The mock's palette is the default; a light twin of every token is selected by `prefers-color-scheme: light`, as today. Supersedes the console plan's W13 only in that dark, not light, is now the reference design.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **W33** | **Contrast holds in both palettes.** A test holds a declared list of pairs — `--text`, `--muted` and `--faint` each on `--bg` and on `--card` — for both palettes, reads the token values from `tokens.css`, and requires 4.5:1. `--card` is an opaque token (the glass look comes from a border and a gradient drawn over it, not from transparency under the text). The mock's `--faint` is lifted until it passes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **W34** | **Motion.** Entrance motion runs on the first paint with data only: `start()` sets an attribute on `#root`, the entrance rules match only under it, and the first `draw()` with `data !== undefined` clears it at its end. `draw()` replaces `#root`'s children, not `#root`, so the attribute survives until then. Ambient motion (the live dot, the running sheen, the wave field drift) is CSS keyframes. Everything stops under the existing `prefers-reduced-motion: reduce` rule (`tokens.css:51-56`). No pointer parallax.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **W35** | **A derived wave state and a stale flag**, computed by the server from a wave's lanes, through the wave cache. `stale` is a separate boolean, as on `WaveSummary` and `LaneRow`, because every finished wave ends up stale when its pushes stop (`2026-10-02_next-waves.md:138`). The state, in this order: `failed` — a lane whose PR is neither merged nor closed reported `failed` or a non-zero exit and is not alive (the same exclusion `attentionReasons` makes, `domain/attention.ts:44-47`); `done` — at least one lane, and every lane's PR merged or closed; `running` — the wave is not stale and a lane is alive (the cache's raw boolean, `CachedLane.derived.alive`); `settled` — the rest, including a wave with no lanes ("nothing alive, not every PR merged"). Documented in `docs/waves-v1.md` with this order; it summarises what the lanes said, not the work.                                                                                                                                                                                                                                                                  |
| **W36** | **`recentWaves` on the project summary.** `GET /api/v1/projects` gains, per project, its newest at most 12 retained waves, newest first: `{ wave, receivedAt, lanes, state, stale, merged }`, where `merged` counts lanes whose PR is merged (the ring, owner). Read through `cachedWave`; a wave the cache answers `undefined` for (gone between heads and snapshot) is skipped. This **supersedes the console plan's W9 property** that the summary "reads heads, never wave files" (`docs/waves-v1.md` §5.1): cold, it parses at most 12 × N snapshots; warm, none. It stays inside the cache while 12 × N ≤ `MAX_CACHED_WAVES` (512) and the rows stay under `MAX_CACHED_ROWS` (10 000) — about 42 projects; a `?all=1` listing of one large project can evict fleet entries, which then cost one parse each on the next poll. The fleet's ring is `sum(merged) / sum(lanes)` over these waves (no ring when the sum of lanes is 0).                                                                                                                                                                                                              |
| **W37** | **Severity** is derived from the reasons, in `attention.js`: `failed`, `exit`, `gate` → high; `disagreement`, `checks` → medium; `silent` → low. The attention list is ordered by severity, then by receive time. A card's severity tag says so in text, not only colour.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **W38** | **The hero is compact and fleet-only**: the live eyebrow, a headline, one line of live counts that the stat cards then break down, and the wave field below it, at most about 180px tall.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **W39** | **Fleet tabs and search live in the address**: `?tab=active\|flagged\|quiet` (absent = all, never written as `all`) and `?q=` on `/`, read by `query.js` (the same `q` key the project page uses; on a project URL `tab` is ignored and not carried into the project page's links). Tabs partition the projects: `flagged` = the newest recent wave is `failed`, or the project is stale (the summary's existing field), or it has attention; `active` = not flagged, and a recent wave is `running`; `quiet` = the rest. A tab or search change redraws from the answer in hand: `reread()`'s draw-only condition (`app.js` about 888) gains "the route is the fleet before and after", and `body()` (about 290) passes fleet handlers to `renderFleet`. The search box carries `data-key="q"`, so `/` and the caret restore work unchanged. Rows are `details`/`summary` with the project link outside the summary; open rows are kept in a `Set` of project ids that survives `reread()` (unlike the menu's one boolean), read by a second `onToggle` branch (class `project-row`), and set through the `open` property as `shell.js`'s menu does. |
| **W40** | **Re-skin, do not rewrite the app.** `app.js`'s state machine (draw-only rereads, focus and caret restore, the drawer, the menu) is pinned by tests; a lane that touches `draw()`, `reread()`, `body()` or `start()` names the line.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **W41** | **Freshness.** The sync pill shows "synced HH:MM:SS" — the clock time of the last successful load (`clock()` is injected) — and the live dot pings only while there is no offline note.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## 4. The API change (lane U2)

```
GET /api/v1/projects
[{ …ProjectSummary,
   "recentWaves": [ { "wave", "receivedAt", "lanes", "state", "stale", "merged" } ]  // ≤ 12, newest first
}]
```

`state` is one of `failed`, `done`, `running`, `settled` (W35). A project with no
retained wave answers `[]`. The bound, the order, the state rule and the cost
note of W36 are documented in `docs/waves-v1.md` §5.1.

## 5. Lanes

**Order.** U1a, U1b and U2 in parallel; U3a after U1b and U2; U3b after U3a; U4
after U1b. Ownership of shared files: U1b owns `tokens.css`, `shell.css`,
`shell.js` and adds every new tag to `ALLOWED_TAGS` once; U3a/U3b own `fleet.css`
and `views/fleet.js`; U4 owns `app.css`, `project.css`, `drawer.css` and the
project views. No lane edits a file another lane owns.

```
U1a ─────────────────────────
U1b ──┬──► U3a ──► U3b
U2  ──┘
U1b ──► U4
```

### U1a-fonts-csp (normal)

The three variable `woff2` files and their licences under `public/fonts/`, the
`@font-face` rules, `font-src 'self'` in the CSP, `.woff2` in the static
allow-list, the two tests and the doc that pin the CSP whole, and `logo.js`'s
stale comment about `img-src`.

### U1b-tokens-shell (high)

`tokens.css` (both palettes, W32, W33, the contrast test), the ground with its
glows and grid, the sticky blurred top bar with the four-bar mark (replacing the
current mark), the sync pill (W41) and a refresh button (a `button` that asks the
app for a pass: `shell()` gains handlers; `app.d.ts`/`shell.d.ts` change), the
projects menu restyled, the first-paint attribute (W34; `start()` and `draw()`
named), and the footer legend: the five wave states added beside the three
existing terms, which the project page still uses.

### U2-recent-waves (normal)

`recentWaves` (W35, W36): the state as a pure function in `domain/` with a table
test (every branch, zero lanes, merged and closed, alive under stale), the read
model through the cache, `docs/waves-v1.md` §5.1, and the page's `projects.js`
shape check.

### U3a-fleet-hero-stats-rows (high), after U1b and U2

The fleet page: the compact hero (W38) with the wave field; the stat cards; the
projects section with its tabs and search in the address and its rows (W39):
status dot, name link, attention count, repo and id, the segmented wave bar (each
segment's state in text), the caption, the lane count, the merged ring, the
expanded wave chips. `app.js`'s `reread()` and `body()` as W39 names them.

### U3b-fleet-attention-side (high), after U3a

The attention cards (W37: severity order, the coloured edge, the kind pill, the
text tag, the project and wave/lane chips, the lane link, the PR link under the
drawer's rule), the "all clear" state, the status side card (wave C), and the
footer totals.

### U4-project-reskin (normal), after U1b

The project page, the status panel and the drawer restyled in the new tokens:
cards, pills, the wave strip as segments, the lane table. No behaviour change.

### Deploys

One after U1a, U1b and U2, one after U3b, one after U4. Each runs the checks in
`deploy/README.md` and opens the live page in a browser: no CSP violation in the
console, the fonts load from the service's origin.

## 6. Risk and review

U1a (a CSP change), U1b, U3a and U3b (the most new markup from pushed text) are
high risk: a brief review and a pre-PR review each, and the XSS test's payload set
is sent through every field each lane draws (project names, repos, wave ids, lane
ids, seats, attention text). ESLint's ban on HTML sinks stays green with no
disable comment, and `assertNoInjectedMarkup` keeps walking the whole document.

## 7. Not in this plan

| Candidate                                   | Note                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| Any write from the page (resolve, dispatch) | The service is a witness. A control surface would be its own design, with its own auth. |
| Pointer parallax                            | Motion for its own sake on a status page.                                               |
| Queue, progress or ETA states               | They need a pusher to report them; W35's states are what the data supports.             |
