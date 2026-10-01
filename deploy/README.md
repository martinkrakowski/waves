# deploy

The image, the Kubernetes manifests and the deploy script. The base manifests
name no host, no registry, no ingress controller and no certificate issuer, so
they work on any cluster; the `midnight` overlay is the only place our own
infrastructure is written down.

## Run it anywhere

The service reads `WAVES_HOST`, `WAVES_PORT`, `WAVES_DATA_DIR` and the
optional `WAVES_READ_TOKEN_FILE`, answers `/healthz`, and serves the status page
and the read-only API from `packages/server/public`.

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
API request. Give the pod an init container that `chown`s and `chmod`s `/data`
before the server starts, or bind the volume from a filesystem that already
hands it over with those two properties.

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

### The weekly backup

The data directory is the only state the service has. Copy `projects.json` out
once a week; it names every project and carries no secret:

```sh
POD=$(kubectl -n waves get pods \
  -l app.kubernetes.io/name=waves,app.kubernetes.io/component=server \
  -o jsonpath='{.items[0].metadata.name}')
mkdir -p backup
kubectl -n waves cp "$POD:/data/projects.json" \
  "backup/projects-$(date -u +%F).json"
```

The snapshots beside it are re-pushed by whichever project owns them, so the
project list is the part worth keeping.

### The admin Secret

There is no write path yet, so the deployment carries no Secret and the base
does not reference one. When the write path lands, its token arrives as a
Secret that the overlay mounts as a file — a file, so the token stays out of the
process environment and out of `/proc` — and the overlay points
`WAVES_READ_TOKEN_FILE` at it.
