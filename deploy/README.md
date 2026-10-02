# deploy

The image, the Kubernetes manifests and the deploy script. The base manifests
name no host, no registry, no ingress controller and no certificate issuer, so
they work on any cluster; the `midnight` overlay is the only place our own
infrastructure is written down.

## Run it anywhere

The service reads `WAVES_HOST`, `WAVES_PORT`, `WAVES_DATA_DIR`, the optional
`WAVES_READ_TOKEN_FILE` and `WAVES_ADMIN_TOKEN_FILE`, and `WAVES_TRUST_PROXY`,
answers `/healthz` and `/readyz`, serves the status page and the read-only API
from `packages/server/public`, and accepts the write routes: `PUT` and `DELETE`
on a wave with the project's own token, `POST` on the project collection and
`DELETE` on a project with the admin token.

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
