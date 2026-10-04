#!/bin/sh
#
# Removes the launchd LaunchAgents that run `waves register-all` and, when it is
# installed, `waves sync`. Run it from anywhere:
#
#   sh deploy/launchd/uninstall.sh
#
# It takes both agents out of the session and deletes the files they installed.
# The register-all agent is always taken out, loaded or not; the sync agent only
# when its plist is there, which is what tells this script there was one, though
# its wrapper is removed either way.
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
# is what says whether there is an agent to take out. Its wrapper goes either
# way: an install interrupted between the two renames leaves a wrapper with no
# plist, and a wrapper is a shell script naming a program the agent would have
# run — one this script should not leave behind on the strength of a file that is
# missing.
rm -f "$sync_wrapper"

if [ -e "$sync_plist" ]; then
  "$launchctl" bootout "$domain/$SYNC_LABEL" 2>/dev/null || true
  rm -f "$sync_plist"

  say "uninstall.sh: removed $SYNC_LABEL"
  say "  removed  $sync_plist"
  say "  removed  $sync_wrapper"
  say "  kept     $sync_log (the record of every run; delete it yourself if you want it gone)"
  say "  kept     $config/sync.json (the sync agent is installed again from it)"
else
  say "uninstall.sh: no $SYNC_LABEL.plist was there, so no agent was booted out"
fi

say "  to install it again: sh deploy/launchd/install.sh <https url>"
