# @hexagen-monaco/waves-client

The `waves` CLI: register a project with a [waves](https://github.com/martinkrakowski/waves) server, then push its wave snapshots, send its status and delete a wave. Snapshots follow the `waves/v1` contract and the status document the `waves-status/v1` one (`docs/waves-v1.md` in the repository).

```sh
npm install --save-dev @hexagen-monaco/waves-client
```

Node 22.7 or later. No runtime dependencies beyond `@hexagen-monaco/waves-contract`.

## Register a project (once, by the server's operator)

```sh
WAVES_URL=https://waves.example.com \
  waves register my-project --name "My Project" \
  --repo https://github.com/me/my-project \
  --admin-token-file ~/.config/waves/admin.token
```

The admin token is read only from a file at mode 0600 or stricter, or from stdin with `--admin-token-stdin`; never from argv or the environment. The minted project token is written to `~/.config/waves/<id>.token` (0600) and is never printed. Registering an existing id fails unless `--rotate` is given, which replaces the token.

## Register with an enrollment token

An enrollment token is a second, optional server secret that can do one thing: create a project that does not exist yet. It cannot rotate a token or delete a project, so `--rotate` with an enrollment flag is refused locally, before anything is read or sent. `register` takes it in place of the admin token:

```sh
WAVES_URL=https://waves.example.com \
  waves register my-project --name "My Project" \
  --enrollment-token-file ~/.config/waves/enroll.token
```

`--enrollment-token-stdin` reads it from stdin instead, for an interactive run. Exactly one of `--admin-token-file`, `--admin-token-stdin`, `--enrollment-token-file` and `--enrollment-token-stdin` may be given. Both token files pass the same 0600 trust check.

## Register every project in a list

```sh
WAVES_URL=https://waves.example.com \
  waves register-all --enrollment-token-file ~/.config/waves/enroll.token \
  --projects ~/.config/waves/projects.json --verbose
```

`register-all` reads a list of projects and registers each one that has no token file on this machine, which is the shape a schedule needs: the same command an hour later skips whatever it already did.

The list is `~/.config/waves/projects.json` (`WAVES_CONFIG_DIR` overrides the directory, `--projects` the file): a JSON array of at most 64 entries, each an object with an `id` and a `name` and optionally a `repo`.

```json
[
  {
    "id": "client-portal",
    "name": "Client Portal",
    "repo": "https://github.com/me/client-portal"
  },
  { "id": "campaign-foundry", "name": "Campaign Foundry" }
]
```

Every entry is checked before any request goes out, with the contract's own rules: a project id, a name the server would store, an https-only repo carrying no user or password, and no id twice. One bad entry fails the whole run with exit 2 and sends nothing. A refusal names the entry by its index in the file (`entry 3: id is not a project id`) and never quotes a value from it.

Per entry, in order: a token file already there is counted as skipped and no request is made; otherwise the project is registered with the enrollment token and the token file written 0600 exactly as `register` writes it. Requests are paced at least a second apart, and a `429` is retried for the wait the server named. `--verbose` prints the skip lines; without it they are absent. The run ends with one line, `N skipped, M registered, K conflicts, J failed`, on stdout. A `409` is counted as a conflict, printed on every run until the owner resolves it, and does not fail the run.

`register-all` never rotates anything, and has no `--rotate`: a token that was issued elsewhere is yours to recover with an admin rotate. A `401` or `403` stops the run after one line, because the credential is wrong for every entry and each further attempt would be charged to the server's failure allowance. Under launchd, use the file form of the flag: there is no terminal to type the token on stdin. The worst case is a long list with a server that throttles — a run can take longer than an hour — so the LaunchAgent's interval is a floor, not a promise; launchd never runs two copies of one label at once.

## Push a wave

```sh
WAVES_URL=https://waves.example.com WAVES_PROJECT=my-project \
  waves push --wave my-wave --file status.json --interval 10
```

The input is `{ "lanes": [...] }` or a full envelope; the CLI fills in `schema`, `project`, `wave`, `generatedAt` and `intervalSeconds`, and validates the envelope locally before sending. Log tails are stripped unless `--include-tails` is given, and then truncated to their last 4 KiB. `--stdin` reads the input from stdin. `waves delete --wave <wave>` removes a wave.

## Send the project's status

```sh
WAVES_URL=https://waves.example.com WAVES_PROJECT=my-project \
  waves status --file status.json --interval 10
```

Some things a project knows are about the project rather than about any one wave: how many pull-request rows a listing could not read, and what its last `plan:verify` artifact said. Those go in their own document, with `waves-status/v1` as its schema, and `waves status` sends it to the project's own status route.

The input is a JSON object with two optional keys, `prs` and `backlog`, and no others:

```json
{
  "backlog": {
    "state": "recorded",
    "at": "2026-10-03T07:55:00Z",
    "scope": { "kind": "full", "plans": ["plan:verify"] },
    "premises": [{ "lane": "C1", "plan": "plan:verify", "status": "holds" }]
  }
}
```

`{}` is a valid input and means "alive, nothing to report". The CLI fills in `schema`, `project`, `generatedAt` and `intervalSeconds` — the first two from `WAVES_PROJECT` and its own clock, whatever the input said — and validates the document locally before sending, with the same closed-object rule the server applies. Any other key in the input is refused rather than dropped, so a misspelt `backlogg` is a mistake and not a status with nothing in it. `--stdin` reads the input from stdin. The project token is read the same way a push reads it, from `~/.config/waves/<project>.token`, and is never printed.

**Pacing.** The server gives a project one write a second, shared by its pushes and its status. A `429` is waited for exactly as long as the `Retry-After` header asks, up to a minute, so a status sent right after a push is slowed down rather than refused.

## Configuration

| Variable                      | Meaning                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `WAVES_URL`                   | The server. Required.                                                                             |
| `WAVES_PROJECT`               | The project a push, a status or a delete belongs to.                                              |
| `WAVES_CONFIG_DIR`            | Where token files live (default `~/.config/waves`).                                               |
| `WAVES_CA_FILE`               | A CA certificate to pin (default `~/.config/waves/ca.crt` if present, else the system store).     |
| `WAVES_ALLOW_INSECURE_HTTP=1` | Allow plain `http://` to a non-loopback host. Warns on every request: the token travels in clear. |

TLS verification is always on. Plain `http://` is accepted for loopback hosts without the opt-in.

## Exit codes

`0` success, `1` a server or network failure (after at most two retries for a network error and, for `push` and `status`, a 5xx, and a bounded wait on 429; `register` and `register-all` never retry a 5xx, because the request may already have minted a project), `2` a usage, configuration or local-validation error. A `register-all` run exits `2` for anything wrong with its list or its credential — having sent nothing — and `1` when a request failed or the run stopped; conflicts alone leave it at `0`.

## Licence

MIT.
