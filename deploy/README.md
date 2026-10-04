# deploy

The image, the Kubernetes manifests and the deploy script. The base manifests
name no host, no registry, no ingress controller and no certificate issuer, so
they work on any cluster; the `midnight` overlay is the only place our own
infrastructure is written down.

## Run it anywhere

The service reads `WAVES_HOST`, `WAVES_PORT`, `WAVES_DATA_DIR`, the optional
`WAVES_READ_TOKEN_FILE`, `WAVES_ADMIN_TOKEN_FILE` and
`WAVES_ENROLL_TOKEN_FILE`, and `WAVES_TRUST_PROXY`, answers `/healthz` and
`/readyz`, serves the status page and the read-only API from
`packages/server/public`, and accepts the write routes: `PUT` and `DELETE` on a
wave with the project's own token, `POST` on the project collection and `DELETE`
on a project with the admin token, and `POST` on the project collection for a new
id with the enrollment token.

### With docker

```sh
docker build -t waves .
docker volume create waves-data
docker run --rm -p 8080:8080 -v waves-data:/data waves
```

One process owns a data directory, and the store refuses a directory that is
not owned by it or that other users can read. A fresh named volume is created as
root with mode 0755, so hand it to the account the image runs as before the
first start:

```sh
docker run --rm -u 0 -v waves-data:/data waves \
  sh -c 'chown 1000:1000 /data && chmod 700 /data'
```

### Behind a proxy that terminates TLS

Run the same container and point the proxy at port 8080. The server speaks
plain HTTP and never asks for a client certificate; TLS, and the read token
that goes with it, belong to the proxy or to the network in front of it.

**Behind any proxy, set `WAVES_TRUST_PROXY=1`.** Without it the client address
is the proxy's, so the failure limit — ten failed authentications in sixty
seconds, then a 429 — applies to the proxy and therefore to everyone behind it,
and one person guessing a token locks out every project. With it, the client is
the last entry of `X-Forwarded-For` and every write has to arrive as `https`.
With it unset the service ignores every `X-Forwarded-*` header, which is the
right answer when nothing in front of it is trusted to overwrite them.

Set it only where the proxy really does overwrite those headers. Traefik's
entrypoints keep their default `forwardedHeaders` (`insecure: false`, no
`trustedIPs`), so with that default Traefik deletes every `X-Forwarded-*` and
`X-Real-Ip` a client sent, sets `X-Forwarded-Proto` from the real TLS state of
the connection, and appends the client IP to `X-Forwarded-For`. A service that
trusted those headers behind an ingress configured with
`forwardedHeaders.insecure: true` would take the scheme and the address from
whoever asked, and a write would be accepted over plain http from an address the
caller chose.

With `WAVES_TRUST_PROXY=1` the pod believes whoever reaches it, so keep the
network between it small: a NetworkPolicy that allows ingress only from Traefik's
namespace means an in-cluster pod cannot forge `X-Forwarded-Proto: https` and push
a wave, or spend another project's failure allowance.

Note that with a viewer token configured, `OPTIONS` and `PATCH` answer 401 rather
than 405: the read gate runs before the method is looked at, because a path
guarded by a token must not tell an unauthenticated caller which methods it takes.

### On Kubernetes

Render the base and apply it, then add your own overlay for the parts that name
your infrastructure:

```sh
kubectl kustomize deploy/k8s/base | kubectl apply -f -
```

An overlay only needs to set the image and patch the ingress, as
`deploy/k8s/overlays/midnight` does. Copy it, change the four values it carries,
and it is yours.

The one thing a cluster hands the container and docker does not is the data
directory itself, so read this before the first deploy: the store demands a
directory owned by uid 1000 with mode 0700, and the kubelet creates the volume
root as root with group write, which the store refuses. `/healthz` does not read
the store, so a pod in that state passes its probes and answers 500 to every
API request, which is why readiness asks `/readyz` and only liveness asks
`/healthz`. The base deployment avoids this by pointing the server at a
subdirectory, `WAVES_DATA_DIR=/data/store`: the volume root only has to be
writable by uid 1000, and the server creates `store/` itself, owned by uid 1000
at mode 0700. Keep that, or bind a volume that already hands the directory over
with those two properties.

Keep `fsGroupChangePolicy: OnRootMismatch` as well. The pod sets `fsGroup` so the
admin Secret is readable, and on a volume type that honours it — the `local`
PersistentVolume k3s's local-path provisioner creates does — the kubelet otherwise re-applies the group to everything under the
mount for every new pod, which turns `store/` into mode 2770 and its files into 0660. The store refuses that, so the first pod works and every pod after it —
a redeploy, a rollout restart, an eviction — answers 503 on `/readyz`. If a volume is already in that state, repair it from inside the pod:

```sh
kubectl -n waves exec deploy/waves -- chmod -R g-rwxs,o-rwx /data/store
```

Apply the manifest with the policy first, then repair: a repaired volume under a
pod without the policy is widened again by the next pod. The store re-checks the
directory on every call, so the next readiness probe passes with no restart.

## midnight

### deploy.sh

The script builds the image from the committed tree, pushes it to the registry,
renders the overlay with the short SHA as the tag, applies it over ssh and waits
for the rollout.

```sh
sh deploy/deploy.sh --dry-run
sh deploy/deploy.sh
```

The dry run prints the rendered manifests with the image substituted and every
command it would run, and touches nothing. It also reports what a real deploy
would refuse to do — a dirty tree, or a HEAD that is not on `origin/main` —
instead of refusing, so an overlay can be checked before it is committed.

Four variables move the defaults, and no secret passes through any of them:

| variable               | default                               |
| ---------------------- | ------------------------------------- |
| `WAVES_IMAGE_REPO`     | `registry.midnight.lan/library/waves` |
| `WAVES_DOCKER_CONTEXT` | `midnight`                            |
| `WAVES_SSH`            | `m`                                   |
| `WAVES_OVERLAY`        | `deploy/k8s/overlays/midnight`        |

### Trusting the midnight CA

The ingress certificate is issued by the cluster's own issuer. Trust it by
reading it from the cluster, never by fetching it from the network and never by
committing it:

```sh
mkdir -p ~/.config/waves
kubectl -n cert-manager get secret midnight-ca -o jsonpath='{.data.ca\.crt}' |
  base64 -d > ~/.config/waves/ca.crt
```

### The admin Secret

The admin token answers two routes: `POST /api/v1/projects` registers a project
and mints its token, and `DELETE /api/v1/projects/<id>` removes one and its
waves. It is one secret for the whole service, read once at startup from a file,
and never in an environment variable, where any co-tenant of the node could read
it from `/proc`.

Write it to a file of your own, mode 0600, and make the Secret from that file:

```sh
umask 077
cat > /root/waves-admin-token
chmod 600 /root/waves-admin-token
kubectl -n waves create secret generic waves-admin \
  --from-file=token=/root/waves-admin-token
```

`--from-file=token=…` is the whole point: a `--from-literal` or a token typed on
the command line is in your shell history, in the API server's audit log and in
`kubectl` process arguments for as long as either keeps them. The value is 32 to
128 characters of `A-Z`, `a-z`, `0-9`, `_` and `-`; anything else, and the
process refuses to start naming `WAVES_ADMIN_TOKEN_FILE`.

The token is read **once**, so rotating it means a restart, not a reload:

```sh
kubectl -n waves rollout restart deploy/waves
```

The base mounts that Secret at `/run/secrets/waves-admin` as an **optional**
volume, so a service nobody has given an admin token starts normally with the
admin routes disabled. `optional: true` also means a Secret that was renamed,
never created, or created in the wrong namespace is not an error: the routes are
simply gone, and the only trace is the startup line

```
waves: admin routes disabled
```

So check that line after any deploy that should have admin. A 404 from
`POST /api/v1/projects` means one of three things, and there is no way to tell
them apart from the outside: the Secret is missing, the file is not readable, or
the path is wrong. The readiness of the deployment does not depend on it, which
is why the base cannot fail closed loudly here.

### The enrollment Secret

The enrollment token does one thing: `POST /api/v1/projects` with no query, for
an id that does not exist yet. It cannot rotate a token, cannot remove a project
and cannot touch a wave — those are `403` under it and `401` on a push or a wave
delete — so a copy that leaks can add a project and nothing else. The admin token
keeps every power it has, and it is the only token that can register past the
ceiling of 64 projects.

It is optional, independent of the admin Secret, and made from a file of your own
the same way:

```sh
umask 077
cat > /root/waves-enroll-token
chmod 600 /root/waves-enroll-token
kubectl -n waves create secret generic waves-enroll \
  --from-file=token=/root/waves-enroll-token
kubectl -n waves rollout restart deploy/waves
```

The value is 32 to 128 characters of `A-Z`, `a-z`, `0-9`, `_` and `-`, exactly
as for the admin token, and it **must differ from the admin token**: with both
files present and holding the same value the server refuses to start with exit
`2` and

```
waves: WAVES_ENROLL_TOKEN_FILE holds the admin token; the two must differ
```

Without the Secret, enrollment is disabled and the only trace is the startup line

```
waves: enrollment disabled
```

and `POST /api/v1/projects` is answered by the admin token alone. Revocation is
the same two steps as for the admin Secret, in the other order:

```sh
kubectl -n waves delete secret waves-enroll
kubectl -n waves rollout restart deploy/waves
```

### Automatic registration

`waves register-all` reads the list you keep at `~/.config/waves/projects.json`
and registers every project in it that has no token file on this machine. It
runs on the Mac that pushes: registration answers with a project's token once,
and every push reads `~/.config/waves/<id>.token` here, so a schedule anywhere
else would mint tokens no pusher ever receives. A LaunchAgent runs it once an
hour and once at login.

1. Make the token on the Mac, where the client reads it, and create the Secret
   from that file over stdin, so the value is never typed, never on a command
   line and never in a file on midnight. Run these yourself, never through an
   agent:

   ```sh
   umask 077
   mkdir -p ~/.config/waves && chmod 700 ~/.config/waves
   rm -f ~/.config/waves/enroll.token
   openssl rand -hex 32 > ~/.config/waves/enroll.token
   ssh m 'KUBECONFIG=$HOME/.kube/config kubectl -n waves create secret generic waves-enroll --from-file=token=/dev/stdin' < ~/.config/waves/enroll.token
   ssh m 'KUBECONFIG=$HOME/.kube/config kubectl -n waves rollout restart deploy/waves'
   ```

   `openssl rand -hex 32` is 64 characters the token grammar accepts, and a
   random value cannot equal the admin token. The `chmod` and the `rm` are there
   because `umask` and `mkdir -m` only shape what they create: an existing
   directory or token file keeps its mode, and a loose one would be refused by
   `install.sh` and readable by others. The directory must be yours and
   reachable by nobody else (`chmod 700`); the client refuses anything looser,
   and so does `install.sh`. (The recipe in
   [The enrollment Secret](#the-enrollment-secret) suits a Secret made on the
   cluster's host; `ssh m` logs in as you, not as root, so it cannot read a
   file under `/root` afterwards.)

2. Check the server took it: the pod's log no longer opens with
   `waves: enrollment disabled`.

   A file of mode 0400 is accepted as well, if you would rather it not be
   writable.

3. Write `~/.config/waves/projects.json`, the list you maintain:

   ```json
   [
     {
       "id": "client-portal",
       "name": "Client Portal",
       "repo": "https://github.com/…"
     }
   ]
   ```

   `campaign-foundry` may be listed too: its token is already on this machine, so
   it is counted as skipped and no request is made for it.

4. Install the client, then the LaunchAgent:

   ```sh
   npm i -g @hexagen-monaco/waves-client@0.2.0
   sh deploy/launchd/install.sh https://waves.midnight.lan
   ```

   The URL is the one argument `install.sh` takes and has to be `https`. The
   first run starts at once, so `~/.config/waves/ca.crt` has to be there
   already (see [Trusting the midnight CA](#trusting-the-midnight-ca)): without
   it every entry fails on the certificate. The
   script renders nothing at all unless `~/.config/waves/enroll.token` is there
   as a real file of mode 0600 or 0400, and it never reads it: what reaches the
   wrapper is the path, and the client reads the value.

   **macOS asks for Local Network access.** A program launchd starts in the
   background needs it to reach `waves.midnight.lan`, and until it is granted
   every run fails with `connect EHOSTUNREACH`. Allow the prompt for `node`, or
   switch `node` on in System Settings → Privacy & Security → Local Network, then
   run the agent once:

   ```sh
   launchctl kickstart -k gui/$(id -u)/cloud.krakowski.waves.register-all
   ```

   A node upgrade is a new binary, so the permission may be asked for again
   after re-running `install.sh`.

5. Read `~/Library/Logs/waves-register-all.log` after the first run. Every run
   opens with one dated line and ends with the client's own summary,
   `N skipped, M registered, K conflicts, J failed`. A `409` is printed on every
   run until it is resolved and is not a failure of the job.

6. To rotate the enrollment token: delete the Secret, create it again from a new
   0600 file, `kubectl -n waves rollout restart deploy/waves`, and replace
   `~/.config/waves/enroll.token`. Runs between the restart and the local
   replacement abort on a 401, which the log says.

7. After a node upgrade, re-run
   `sh deploy/launchd/install.sh https://waves.midnight.lan`; it is idempotent.
   `sh deploy/launchd/uninstall.sh` boots the agent out and removes the plist
   and the wrapper, and leaves the log, `~/.config/waves` and every token alone.

macOS never rotates that log — launchd only ever appends to it — so if it grows,
truncate it by hand:

```sh
: > ~/Library/Logs/waves-register-all.log
```

### The `waves sync` agent

The same `install.sh` installs a second agent, `cloud.krakowski.waves.sync`,
**only when `~/.config/waves/sync.json` is there** — that file is the whole
configuration of a run, so an agent with nothing to run is not installed, and
without it the script says so in one line and installs the register-all agent
alone. With a `sync.json` of mode 0600 or 0400 (the client's own rule, which the
install repeats) it reads the one number the timer needs:

```sh
sh deploy/launchd/install.sh https://waves.midnight.lan
```

- `every` is the plist's `StartInterval` and its `ThrottleInterval`: it is a
  whole number of seconds between 10 and 100, and absent from the file it is the
  client's own default of 60. Anything else — 5, 101, `"x"`, a file that is not
  JSON — refuses the install with nothing rendered and nothing loaded, as any
  other refusal there does.
- The plist carries the URL, the config directory and **the `PATH` you ran
  `install.sh` with**, because launchd's own is `/usr/bin:/bin:/usr/sbin:/sbin`
  and a collector that calls `node` or `gh` out of nvm or Homebrew would fail
  under the agent and pass by hand. A `PATH` holding a character the plist could
  not take is refused rather than escaped.
- Nothing in the plist or the wrapper holds a token: `waves sync` reads each
  project's own token out of the config directory after its collector has exited.
- Delete `sync.json` and re-run `install.sh` and the agent is booted out and its
  two files removed, so a schedule with nothing to run does not keep asking for
  it. `sh deploy/launchd/uninstall.sh` takes both agents out.

**The log is bounded by the wrapper, not by newsyslog.**
`~/Library/Logs/waves-sync.log` gets one or two lines a minute, launchd only ever
appends to it, and a run a minute is a machine on for weeks. So the wrapper
counts the log before each run and, when it is over 5000 lines, keeps its last
1000 and says so in one dated line. It rewrites the file where it lies rather
than renaming a new one over it: launchd opened that file once, before it
started this script, so a renamed file would leave the run writing to an inode
with no name and reset the 0600 mode `install.sh` set. `uninstall.sh` keeps the
log, as it keeps the register-all one.

```sh
tail -n 20 ~/Library/Logs/waves-sync.log
```

### Deploy-time checks

Run these after the first deploy of the write path, in this order:

1. Traefik's own values show no `forwardedHeaders` on `web` or `websecure`, in
   the entrypoints it was installed with. If one of them sets
   `forwardedHeaders.insecure: true`, every client-sent `X-Forwarded-Proto` is
   believed and `WAVES_TRUST_PROXY=1` becomes unsafe.
2. `curl -s -o /dev/null -w '%{http_code}' -X PUT http://<host>/api/v1/projects/a/waves/b`
   prints `308`. That is the redirect middleware: the write never reaches the
   service over plain http from outside.
3. Through `kubectl port-forward`, a PUT carrying `X-Forwarded-Proto: http` is
   refused with 403. That is the service refusing a write that did not arrive as
   https, which is what makes `WAVES_TRUST_PROXY=1` safe to set.
4. `kubectl api-resources --api-group=traefik.io | grep middlewares` lists the
   middleware resource. An older Traefik serves the same CRD under
   `traefik.containo.us`, in which case the middleware manifest and the router
   annotation both need that group instead.
5. `curl -v -H 'Expect: 100-continue' -T <1 MiB file> -H 'Authorization: Bearer wrong' https://<host>/api/v1/projects/a/waves/b`
   answers 401 with no `Done waiting for 100-continue`. The service sends its 100
   only after it has authenticated and rate-limited the request, so a wrong token
   is refused without the body ever leaving the client. Traefik forwards `Expect`
   and holds the body until the backend answers with a 100, falling back to
   sending it after a second, so a `curl` that does wait is telling you the
   request never reached the service.
6. With the enrollment Secret **absent** and the admin Secret present, an
   enrollment-shaped `POST` — any bearer that is not the admin token — answers
   `401`, never `201`: the route is the admin token's, locked rather than
   absent. With neither Secret, it answers `404`.
7. With the enrollment Secret **present**, `?rotate=1` under the enrollment token
   answers `403` with `enrollment token cannot do this`, and a `DELETE` under it
   answers `403` as well. Both are the enrollment token being refused, not the
   admin token being absent: a `404` on either would mean the admin token is
   missing too.

### The weekly backup

The data directory is the only state the service has. Copy `projects.json` out
once a week; it names every project and carries only the sha256 digests of their
tokens, never a token:

```sh
POD=$(kubectl -n waves get pods \
  -l app.kubernetes.io/name=waves,app.kubernetes.io/component=server \
  -o jsonpath='{.items[0].metadata.name}')
mkdir -p backup
kubectl -n waves cp "$POD:/data/store/projects.json" \
  "backup/projects-$(date -u +%F).json"
```

The snapshots beside it are re-pushed by whichever project owns them, so the
project list is the part worth keeping.
