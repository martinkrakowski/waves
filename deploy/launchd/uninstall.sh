#!/bin/sh
#
# Removes the launchd LaunchAgent that runs `waves register-all`. Run it from
# anywhere:
#
#   sh deploy/launchd/uninstall.sh
#
# It takes the agent out of the session and deletes the two files it installed.
# It leaves the log, ~/.config/waves and every token file alone: those are the
# owner's, the log is the only record of what the runs did, and a token file is
# the credential the client reads. `sh deploy/launchd/install.sh <url>` puts it
# back.

set -eu

# The paths below are character sets nowhere, but the locale decides what a
# bracket range means, and nothing here should.
LC_ALL=C
export LC_ALL

LABEL=cloud.krakowski.waves.register-all

say() {
  printf '%s\n' "$*"
}

support="$HOME/Library/Application Support/waves"
wrapper="$support/register-all.sh"
agents="$HOME/Library/LaunchAgents"
plist="$agents/$LABEL.plist"
log="$HOME/Library/Logs/waves-register-all.log"
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
say "  to install it again: sh deploy/launchd/install.sh <https url>"
