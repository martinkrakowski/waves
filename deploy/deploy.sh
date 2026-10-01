#!/bin/sh
#
# Deploys waves to the midnight cluster: builds the image from the committed
# tree, pushes it, renders the overlay with the new tag, applies it and waits
# for the rollout. Nothing here reads, prints or passes a secret.
#
# Run from the repository root. `sh deploy/deploy.sh --dry-run` prints what
# would run and changes nothing.

set -eu

NAMESPACE=waves
DEPLOYMENT=waves
ROLLOUT_TIMEOUT=5m

usage() {
  cat <<'EOF'
usage: sh deploy/deploy.sh [--dry-run]

  --dry-run  print the rendered manifests and the commands, run nothing

environment:
  WAVES_IMAGE_REPO      image repository without a tag
                        (default registry.midnight.lan/library/waves)
  WAVES_DOCKER_CONTEXT  docker context that reaches the registry (default midnight)
  WAVES_SSH             ssh destination holding the kubeconfig (default m)
  WAVES_OVERLAY         kustomize overlay to render
                        (default deploy/k8s/overlays/midnight)
EOF
}

DRY_RUN=0
case "${1:-}" in
  --dry-run)
    DRY_RUN=1
    ;;
  -h | --help)
    usage
    exit 0
    ;;
  "")
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

# One argument only, so a stray second one is refused rather than ignored.
if [ "$#" -gt 1 ]; then
  usage >&2
  exit 2
fi

TAG=$(git rev-parse --short HEAD)
IMAGE_REPO=${WAVES_IMAGE_REPO:-registry.midnight.lan/library/waves}
IMAGE="$IMAGE_REPO:$TAG"
IMAGE_PLACEHOLDER="$IMAGE_REPO:latest"
CONTEXT=${WAVES_DOCKER_CONTEXT:-midnight}
NODE=${WAVES_SSH:-m}
OVERLAY=${WAVES_OVERLAY:-deploy/k8s/overlays/midnight}

# The arguments are constants from this script, never input from a caller, so
# this only quotes them; `$HOME` is left to the far shell.
remote() {
  ssh "$NODE" "KUBECONFIG=\$HOME/.kube/config $*"
}

say() {
  printf '%s\n' "$*"
}

# A dry run has nothing to protect, so it reports what it would have refused and
# goes on to print the manifests.
refuse() {
  if [ "$DRY_RUN" -eq 1 ]; then
    say "deploy: warning: $1"
  else
    printf 'deploy: refusing: %s\n' "$1" >&2
    exit 1
  fi
}

[ -z "$(git status --porcelain)" ] ||
  refuse "the working tree is not clean, so the image would not match HEAD"
git merge-base --is-ancestor HEAD origin/main ||
  refuse "HEAD is not on origin/main, so this has not been reviewed in place"

# Checked here rather than inside the pipeline below, where a missing binary
# would be lost in the status of the last stage.
HAVE_KUBECTL=0
if command -v kubectl >/dev/null 2>&1; then
  HAVE_KUBECTL=1
elif [ "$DRY_RUN" -eq 1 ]; then
  say "deploy: warning: kubectl is not installed here, so $OVERLAY is not rendered"
else
  printf 'deploy: kubectl is required\n' >&2
  exit 1
fi

if [ "$DRY_RUN" -ne 1 ]; then
  command -v docker >/dev/null 2>&1 || {
    printf 'deploy: docker is required\n' >&2
    exit 1
  }
  command -v ssh >/dev/null 2>&1 || {
    printf 'deploy: ssh is required\n' >&2
    exit 1
  }
fi

# The overlay carries the tag as `latest` and this rewrites it to the SHA that
# was pushed, so a deploy never runs a floating tag.
render() {
  kubectl kustomize "$OVERLAY" | sed "s|$IMAGE_PLACEHOLDER|$IMAGE|"
}

if [ "$DRY_RUN" -eq 1 ]; then
  say "deploy: dry run, nothing is built, pushed or applied"
  say "deploy: image $IMAGE"
  say "deploy: manifests"
  if [ "$HAVE_KUBECTL" -eq 1 ]; then
    render
  fi
  say "deploy: commands"
  say "+ git archive --format=tar HEAD | docker --context $CONTEXT build -t $IMAGE -"
  say "+ docker --context $CONTEXT push $IMAGE"
  say "+ kubectl kustomize $OVERLAY | sed 's|$IMAGE_PLACEHOLDER|$IMAGE|' | remote kubectl apply -f -"
  say "+ remote kubectl -n $NAMESPACE rollout status deployment/$DEPLOYMENT --timeout=$ROLLOUT_TIMEOUT"
  exit 0
fi

say "deploy: building $IMAGE"
git archive --format=tar HEAD | docker --context "$CONTEXT" build -t "$IMAGE" -

say "deploy: pushing $IMAGE"
docker --context "$CONTEXT" push "$IMAGE"

say "deploy: applying $OVERLAY to $NODE"
# Held in a variable rather than piped, so a render that fails stops the
# deploy before anything reaches the cluster.
MANIFESTS=$(render)
printf '%s\n' "$MANIFESTS" | remote kubectl apply -f -

remote kubectl -n "$NAMESPACE" rollout status "deployment/$DEPLOYMENT" \
  --timeout="$ROLLOUT_TIMEOUT"

say "deploy: $DEPLOYMENT is rolled out in $NAMESPACE"