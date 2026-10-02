# @hexagen-monaco/waves-client

The `waves` CLI: register a project with a [waves](https://github.com/martinkrakowski/waves) server, then push, update and delete its wave snapshots. Snapshots follow the `waves/v1` contract (`docs/waves-v1.md` in the repository).

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

## Push a wave

```sh
WAVES_URL=https://waves.example.com WAVES_PROJECT=my-project \
  waves push --wave my-wave --file status.json --interval 10
```

The input is `{ "lanes": [...] }` or a full envelope; the CLI fills in `schema`, `project`, `wave`, `generatedAt` and `intervalSeconds`, and validates the envelope locally before sending. Log tails are stripped unless `--include-tails` is given, and then truncated to their last 4 KiB. `--stdin` reads the input from stdin. `waves delete --wave <wave>` removes a wave.

## Configuration

| Variable                      | Meaning                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `WAVES_URL`                   | The server. Required.                                                                             |
| `WAVES_PROJECT`               | The project a push or delete belongs to.                                                          |
| `WAVES_CONFIG_DIR`            | Where token files live (default `~/.config/waves`).                                               |
| `WAVES_CA_FILE`               | A CA certificate to pin (default `~/.config/waves/ca.crt` if present, else the system store).     |
| `WAVES_ALLOW_INSECURE_HTTP=1` | Allow plain `http://` to a non-loopback host. Warns on every request: the token travels in clear. |

TLS verification is always on. Plain `http://` is accepted for loopback hosts without the opt-in.

## Exit codes

`0` success, `1` a server or network failure (after at most two retries for network errors and 5xx, and a bounded wait on 429), `2` a usage, configuration or local-validation error.

## Licence

MIT.
