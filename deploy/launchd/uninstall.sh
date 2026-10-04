#!/bin/sh
#
# Removes the launchd LaunchAgents that run `waves register-all` and, when it is
# installed, `waves sync`. Run it from anywhere:
#
#   sh deploy/launchd/uninstall.sh
#
# It takes both agents out of the session and deletes the files they installed.
# The register-all agent is always taken out, loaded or not; the sync agent when
# its plist is there, which is what tells this script there was one — and a
# wrapper with no plist is a half-install, which goes too.
# It leaves both logs, ~/.config/waves, every token file and sync.json alone:
# those are the owner's, a log is the only record of what the runs did, a token
# file is the credential the client reads, and sync.json is the configuration the
# sync agent would be reinstalled from.
# `sh deploy/launchd/install.sh <url>` puts them back.

set -eu

# The paths below are character sets nowhere, but the locale decides what a
# bracket range means, and nothing here should.
LC_ALL=C
export LC_ALL

LABEL=cloud.krakowski.waves.register-all
SYNC_LABEL=cloud.krakowski.waves.sync

say() {
  printf '%s\n' "$*"
}

# Every refusal is the same shape: one line on stderr, exit 2, and nothing
# removed.
refuse() {
  printf 'uninstall.sh: refusing: %s\n' "$1" >&2
  exit 2
}

support="$HOME/Library/Application Support/waves"
wrapper="$support/register-all.sh"
sync_wrapper="$support/sync.sh"
agents="$HOME/Library/LaunchAgents"
plist="$agents/$LABEL.plist"
sync_plist="$agents/$SYNC_LABEL.plist"
log="$HOME/Library/Logs/waves-register-all.log"
sync_log="$HOME/Library/Logs/waves-sync.log"
config="${WAVES_CONFIG_DIR:-$HOME/.config/waves}"

launchctl="${LAUNCHCTL:-launchctl}"
domain="gui/$(id -u)"

# A bootout that fails is not an error to stop on: the agent may never have
# been loaded, which is exactly the state this script is here to reach.
"$launchctl" bootout "$domain/$LABEL" 2>/dev/null || true

rm -f "$plist" "$wrapper"

say "uninstall.sh: removed $LABEL"
say "  removed  $plist"
say "  removed  $wrapper"
say "  kept     $log (the record of every run; delete it yourself if you want it gone)"
say "  kept     $config and every token file in it"

# The sync agent was only ever installed when sync.json was there, so its plist
# is what says whether there is an agent to take out.
if [ -e "$sync_plist" ]; then
  "$launchctl" bootout "$domain/$SYNC_LABEL" 2>/dev/null || true
  # A bootout that fails leaves the job running, and deleting the files of a job
  # that is still loaded takes the schedule away without stopping the program.
  # `launchctl print` is the question that answers whether the bootout took, and
  # it is asked before anything is deleted.
  if "$launchctl" print "$domain/$SYNC_LABEL" >/dev/null 2>&1; then
    refuse "the agent $SYNC_LABEL is still loaded, so nothing of its was removed"
  fi
  rm -f "$sync_plist" "$sync_wrapper"

  say "uninstall.sh: removed $SYNC_LABEL"
  say "  removed  $sync_plist"
  say "  removed  $sync_wrapper"
  say "  kept     $sync_log (the record of every run; delete it yourself if you want it gone)"
  say "  kept     $config/sync.json (the sync agent is installed again from it)"
else
  # No plist and no agent, so the only thing that can be here is a wrapper an
  # install interrupted between its two renames: a shell script naming a program
  # the agent would have run. It goes rather than waits for an install that may
  # never come.
  rm -f "$sync_wrapper"

  say "uninstall.sh: no $SYNC_LABEL.plist was there, so no agent was booted out"
fi

say "  to install it again: sh deploy/launchd/install.sh <https url>"
