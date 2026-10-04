#!/bin/sh
#
# Installs the launchd LaunchAgent that runs `waves register-all` once an hour
# on the owner's Mac. Run it from the repository root:
#
#   sh deploy/launchd/install.sh https://waves.midnight.lan
#
# It is idempotent: it renders both templates, boots the agents out and back in,
# and running it twice leaves the same files and the same agents. Re-run it
# after a node upgrade, which moves the pinned node and client paths.
#
# It installs the `waves sync` agent as well, and only when there is a
# sync.json in the config directory: that file is the configuration of a run of
# collectors, so an agent with nothing to run is not installed. When the file is
# gone and an agent is loaded, that agent is booted out and removed.
#
# Nothing here reads, prints or copies the enrollment token. Its file is only
# ever stat'ed, for its mode, and the token's path is what reaches the wrapper.
# The sync agent never holds a token at all: waves sync reads each project's own
# token itself, from the config directory the plist names.

set -eu

# The character sets below are ranges, so they must not be read in a locale
# where they are not ordered the way the C locale orders them.
LC_ALL=C
export LC_ALL

LABEL=cloud.krakowski.waves.register-all
SYNC_LABEL=cloud.krakowski.waves.sync
TEMPLATE_URL_SET='A-Za-z0-9 ._~:/?=&%+-'
TEMPLATE_PATH_SET='A-Za-z0-9 /._@+-'
# A PATH goes into the plist like a path does, and it is a colon-separated list,
# so it is the same set plus the one character that separates its parts. Nothing
# else may be added to it: the plist is XML, so a `<` or an `&` would either be
# rendered wrong or be XML this file cannot hold.
TEMPLATE_ENV_PATH_SET='A-Za-z0-9 /._@+:-'
# sync.json's `every`, in seconds: the client's own bounds and default
# (`sync-config.ts`), which install.sh has to agree with because the number it
# reads becomes the agent's interval.
EVERY_MIN=10
EVERY_MAX=100
EVERY_DEFAULT=60
URL_MAX=200

say() {
  printf '%s\n' "$*"
}

# Every refusal is the same shape: one line on stderr, exit 2, and nothing
# rendered and nothing loaded.
refuse() {
  printf 'install.sh: refusing: %s\n' "$1" >&2
  exit 2
}

# The characters of $1 that the character set $2 does not hold. The sets carry
# a space, so they cannot be a glob bracket expression — a space would end the
# word — and `tr` is the readable way to ask. What is left is shown with every
# unprintable byte as `?`: a newline would otherwise be the one leftover a
# command substitution strips, and it would pass for nothing left at all.
outside() {
  printf '%s' "$1" | tr -d "$2" | tr -c '[:print:]' '?'
}

# 1. The URL. One argument, https, a character set the plist and the shell can
# hold, and a length a plist string should not exceed.
if [ "$#" -ne 1 ]; then
  refuse "exactly one argument is expected, the waves https URL, for example sh deploy/launchd/install.sh https://waves.midnight.lan"
fi
url=$1
case "$url" in
  https://*) ;;
  *) refuse "the URL must start with https://, got $url" ;;
esac
if [ "${#url}" -gt "$URL_MAX" ]; then
  refuse "the URL is longer than $URL_MAX characters, which is $(( ${#url} - URL_MAX )) too many"
fi
outside_url=$(outside "$url" "$TEMPLATE_URL_SET")
if [ -n "$outside_url" ]; then
  refuse "the URL holds a character this script will not put in the plist: $outside_url"
fi
# The client takes an origin and nothing else, so a path, a query or a fragment
# is refused here rather than by every hourly run.
rest=${url#https://}
rest=${rest%/}
case "$rest" in
  "" | :* | *:*:* | *[!A-Za-z0-9.:-]*)
    refuse "the URL must be an origin, https://host or https://host:port, with no path, query or fragment: $url"
    ;;
esac

# 2. The enrollment token's file. It has to be there, a real file rather than a
# link, and mode 0600 or 0400 — the same trust check the client makes. `stat` is
# all of it: the file is never opened, so a token that leaks into this script's
# output, or into a process's page cache through it, is not a token this script
# could leak.
config="${WAVES_CONFIG_DIR:-$HOME/.config/waves}"
token="$config/enroll.token"
uid=$(id -u)
# The client refuses a directory of tokens that is a link, someone else's, or
# reachable by anyone but its owner, before it reads the list. So does this, so
# an install that succeeds is one whose hourly runs can start.
if [ -L "$config" ] || [ ! -d "$config" ]; then
  refuse "the config directory $config must be a directory of your own, not a link: mkdir -p -m 700 $config"
fi
config_owner=$(stat -c %u "$config" 2>/dev/null || stat -f %u "$config")
if [ "$config_owner" != "$uid" ]; then
  refuse "the config directory $config belongs to uid $config_owner, not to you ($uid)"
fi
config_mode=$(stat -c %a "$config" 2>/dev/null || stat -f %Lp "$config")
case "$config_mode" in
  *00) ;;
  *) refuse "the config directory $config is mode $config_mode; only you may reach it: chmod 700 $config" ;;
esac
if [ -L "$token" ]; then
  refuse "the token file $token is a symbolic link; it must be the file itself, not a link to it"
fi
if [ ! -f "$token" ]; then
  refuse "no token file at $token; put a copy of the waves-enroll Secret's token there, mode 600"
fi
# GNU first: on Linux `stat -f` is filesystem status and answers `?` with exit
# 0, so trying it first would accept any mode. BSD `stat -c` fails with exit 1
# and falls through to the same command's BSD spelling.
mode=$(stat -c %a "$token" 2>/dev/null || stat -f %Lp "$token")
case "$mode" in
  600 | 400) ;;
  *) refuse "the token file $token is mode $mode; it must be 600 or 400" ;;
esac
token_owner=$(stat -c %u "$token" 2>/dev/null || stat -f %u "$token")
if [ "$token_owner" != "$uid" ]; then
  refuse "the token file $token belongs to uid $token_owner, not to you ($uid)"
fi

# 3. node and the client's bin, pinned to absolute paths because launchd runs
# with a PATH of its own. WAVES_NODE and WAVES_CLIENT move them, which is how
# the tests point them at a stub.
node="${WAVES_NODE:-$(command -v node || true)}"
if [ -n "${WAVES_CLIENT:-}" ]; then
  client=$WAVES_CLIENT
else
  npm_root=$(npm root -g 2>/dev/null || true)
  if [ -z "$npm_root" ]; then
    refuse "npm root -g did not answer; install the client first: npm i -g @hexagen-monaco/waves-client"
  fi
  client="$npm_root/@hexagen-monaco/waves-client/dist/cli.js"
fi
case "$node" in
  /*) ;;
  *) refuse "the node path $node is not absolute" ;;
esac
if [ ! -x "$node" ]; then
  refuse "the node path $node is not an executable file"
fi
if [ ! -f "$client" ] || [ ! -r "$client" ]; then
  refuse "the client at $client is not a readable file; install it with npm i -g @hexagen-monaco/waves-client"
fi
# The pair has to run, not merely exist: a client whose own dependencies are
# missing would make every hourly run fail with a line about a module, which
# says nothing about which half of the pair is wrong.
if ! "$node" "$client" help >/dev/null 2>&1; then
  refuse "$node $client help did not exit 0, so the pinned pair does not run"
fi

# 4. The paths that go into the rendered files. They are written into a shell
# script and into XML, so anything a reader would have to quote is refused
# rather than quoted: a home directory with an apostrophe in it is the case
# that matters, and the fix for it is a directory name without one.
support="$HOME/Library/Application Support/waves"
wrapper="$support/register-all.sh"
sync_wrapper="$support/sync.sh"
agents="$HOME/Library/LaunchAgents"
plist="$agents/$LABEL.plist"
sync_plist="$agents/$SYNC_LABEL.plist"
logs="$HOME/Library/Logs"
log="$logs/waves-register-all.log"
sync_log="$logs/waves-sync.log"
# The sync paths are checked whether or not the agent is installed below. They
# are the same directory and the same kind of name, so a home that would be
# refused here has nothing to do with sync.json either.
for path in "$node" "$client" "$config" "$token" "$wrapper" "$log" \
  "$sync_wrapper" "$sync_plist" "$sync_log"; do
  outside_path=$(outside "$path" "$TEMPLATE_PATH_SET")
  if [ -n "$outside_path" ]; then
    refuse "the path $path holds a character install.sh will not render: $outside_path"
  fi
done

# The templates are read from beside this script, so install.sh works from any
# working directory.
here=$(CDPATH= cd "$(dirname "$0")" && pwd) ||
  refuse "cannot find the directory install.sh lives in"
wrapper_template="$here/register-all.sh.template"
plist_template="$here/$LABEL.plist.template"
sync_wrapper_template="$here/sync.sh.template"
sync_plist_template="$here/$SYNC_LABEL.plist.template"
[ -f "$wrapper_template" ] ||
  refuse "no wrapper template at $wrapper_template"
[ -f "$plist_template" ] ||
  refuse "no plist template at $plist_template"

# 5. The sync agent's configuration, and whether there is one at all. The client
# reads sync.json itself and refuses a file it cannot use with exit 2, so this
# holds that file to the same trust the client holds it to and reads the one
# number the timer needs. A refusal here renders nothing, so a bad period is
# never a half-installed agent.
#
# The program below reads that number: fixed text, the file's path and the
# default as arguments, one number or a non-zero exit. Nothing a file holds can
# become part of it, and it prints only on stdout, so what the case below judges
# is exactly what it wrote.
read_every='
const fs = require("node:fs");

const [, , path, fallback] = process.argv;
let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(path, "utf8"));
} catch {
  process.stderr.write("sync.json is not JSON\n");
  process.exit(2);
}
const every =
  parsed === null || typeof parsed !== "object" ? undefined : parsed.every;
if (every === undefined) {
  process.stdout.write(fallback);
} else if (typeof every === "number" && Number.isInteger(every)) {
  process.stdout.write(String(every));
} else {
  process.stderr.write("every must be a whole number of seconds\n");
  process.exit(2);
}
'

sync_config="$config/sync.json"
every=""
env_path=""
sync_installed=no
sync_removed=no
if [ -e "$sync_config" ] || [ -L "$sync_config" ]; then
  if [ -L "$sync_config" ]; then
    refuse "the sync.json at $sync_config is a symbolic link; it must be the file itself, not a link to it"
  fi
  if [ ! -f "$sync_config" ]; then
    refuse "the sync.json at $sync_config is not a regular file"
  fi
  # The same three questions the token file is asked, in the script's own order.
  sync_mode=$(stat -c %a "$sync_config" 2>/dev/null || stat -f %Lp "$sync_config")
  case "$sync_mode" in
    600 | 400) ;;
    *) refuse "the sync.json at $sync_config is mode $sync_mode; waves sync requires 600 or 400, and so does this install" ;;
  esac
  sync_owner=$(stat -c %u "$sync_config" 2>/dev/null || stat -f %u "$sync_config")
  if [ "$sync_owner" != "$uid" ]; then
    refuse "the sync.json at $sync_config belongs to uid $sync_owner, not to you ($uid)"
  fi

  # `every` is read by node, because it is JSON and the client is what parses
  # it. The program is fixed text and the file's path is an argument, never part
  # of it: nothing a file holds can become part of a command line here. It
  # prints one number — the period, or the default when the key is absent — and
  # exits non-zero with a reason on stderr for anything else, which the `if`
  # turns into a refusal rather than letting `set -e` abort the script with no
  # word of its own.
  if ! every=$("$node" -e "$read_every" "$sync_config" "$EVERY_DEFAULT" 2>/dev/null); then
    refuse "waves sync could not use $sync_config; run waves sync by hand for the refusal it prints"
  fi
  case "$every" in
    '' | *[!0-9]*)
      refuse "waves sync read $sync_config and printed '$every', which is not a whole number of seconds for every"
      ;;
  esac
  if [ "$every" -lt "$EVERY_MIN" ] || [ "$every" -gt "$EVERY_MAX" ]; then
    refuse "every is $every, and waves sync takes $EVERY_MIN to $EVERY_MAX seconds; the agent's interval would be a period no wave is pushed with"
  fi

  # The PATH the agent runs collectors with. launchd's own is
  # /usr/bin:/bin:/usr/sbin:/sbin, and a collector that calls node or gh out of
  # nvm or Homebrew would fail under the agent and pass by hand, so the PATH
  # this script was run with is what the plist carries.
  if [ -z "${PATH:-}" ]; then
    refuse "PATH is empty; run install.sh from a shell with the PATH your collectors are found under"
  fi
  outside_env_path=$(outside "$PATH" "$TEMPLATE_ENV_PATH_SET")
  if [ -n "$outside_env_path" ]; then
    refuse "the PATH holds a character install.sh will not render: $outside_env_path"
  fi
  env_path=$PATH

  [ -f "$sync_wrapper_template" ] ||
    refuse "no wrapper template at $sync_wrapper_template"
  [ -f "$sync_plist_template" ] ||
    refuse "no plist template at $sync_plist_template"
  sync_installed=yes
fi

# 6. The three directories and the logs. umask 077 first, so the directories and
# the logs are 0700 and 0600 as they are made; each log is created here rather
# than left to launchd, which would make it 0644 and would drop the output
# silently when the directory was missing. The sync log exists only when the
# sync agent does.
umask 077
mkdir -p "$support" "$agents" "$logs"
: >>"$log"
chmod 600 "$log"
if [ "$sync_installed" = yes ]; then
  : >>"$sync_log"
  chmod 600 "$sync_log"
fi

# 7. Render both templates. Each goes to a fixed temporary name in the
# directory it belongs in and is then moved, so the rename is within one
# directory and an interrupted run leaves the old file rather than a half
# written one. `|` is the delimiter because step 4 proved no path holds one.
sed -e "s|@NODE@|$node|" -e "s|@CLIENT@|$client|" -e "s|@TOKEN@|$token|" \
  "$wrapper_template" >"$support/.register-all.sh.tmp"
chmod 700 "$support/.register-all.sh.tmp"
mv "$support/.register-all.sh.tmp" "$wrapper"

# An origin holds no `&`, so this escaping never has anything to do today. It
# stays, because `&` is the one character a plist cannot hold raw and the
# origin rule is the kind of thing that gets relaxed. Escaping it for sed and
# for XML in one step: sed's replacement writes `\&` as the matched
# text, so this substitution yields the five characters `&amp;`.
url_xml=$(printf '%s\n' "$url" | sed 's/&/\\\&amp;/g')
sed -e "s|@URL@|$url_xml|" -e "s|@WRAPPER@|$wrapper|" -e "s|@LOG@|$log|" \
  -e "s|@CONFIG@|$config|" \
  "$plist_template" >"$agents/.$LABEL.plist.tmp"
chmod 644 "$agents/.$LABEL.plist.tmp"
mv "$agents/.$LABEL.plist.tmp" "$plist"

# The sync agent, when there is one to install. `every` and PATH were proved in
# step 5 and hold nothing XML cannot take.
if [ "$sync_installed" = yes ]; then
  sed -e "s|@NODE@|$node|" -e "s|@CLIENT@|$client|" -e "s|@LOG@|$sync_log|" \
    "$sync_wrapper_template" >"$support/.sync.sh.tmp"
  chmod 700 "$support/.sync.sh.tmp"
  mv "$support/.sync.sh.tmp" "$sync_wrapper"

  sed -e "s|@URL@|$url_xml|" -e "s|@WRAPPER@|$sync_wrapper|" \
    -e "s|@LOG@|$sync_log|" -e "s|@CONFIG@|$config|" \
    -e "s|@PATH@|$env_path|" -e "s|@EVERY@|$every|" \
    "$sync_plist_template" >"$agents/.$SYNC_LABEL.plist.tmp"
  chmod 644 "$agents/.$SYNC_LABEL.plist.tmp"
  mv "$agents/.$SYNC_LABEL.plist.tmp" "$sync_plist"
fi

# 8. Load the agents. bootout first, so a second run replaces the loaded agent
# instead of failing to add one that is already there, and its failure is not
# an error: there may be nothing loaded. bootstrap right after a bootout is
# asynchronous on macOS and can answer "Bootstrap failed: 37/5" for a moment
# while the old one drains, so it is retried.
launchctl="${LAUNCHCTL:-launchctl}"
domain="gui/$(id -u)"

load() {
  load_label=$1
  load_plist=$2
  load_log=$3
  "$launchctl" bootout "$domain/$load_label" 2>/dev/null || true
  attempt=1
  while :; do
    if "$launchctl" bootstrap "$domain" "$load_plist"; then
      return 0
    fi
    if [ "$attempt" -ge 5 ]; then
      refuse "launchctl bootstrap $domain failed $attempt times, and the agent this replaced was already booted out, so nothing is scheduled now; the plist is at $load_plist and the log is at $load_log; run this again from a login session"
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
}

load "$LABEL" "$plist" "$log"

if [ "$sync_installed" = yes ]; then
  load "$SYNC_LABEL" "$sync_plist" "$sync_log"
elif [ -e "$sync_plist" ]; then
  # sync.json is gone but the agent it scheduled is loaded. Leaving it would be
  # a timer with nothing to run, filling the log with a refusal a minute. The
  # bootout is only attempted because the plist is here: an agent that was never
  # installed is not a thing to take out.
  "$launchctl" bootout "$domain/$SYNC_LABEL" 2>/dev/null || true
  rm -f "$sync_plist" "$sync_wrapper"
  sync_removed=yes
fi

# 9. What was installed. The token's path is deliberately absent from this: the
# owner knows where it is, and a line that printed it would be one more copy in
# a terminal scrollback.
say "install.sh: installed $LABEL, running hourly and at login"
say "  wrapper  $wrapper"
say "  plist    $plist"
say "  log      $log"
say "  node     $node"
say "  client   $client"
say "  read the log after the first run: it opens with one dated line per run"
say "  re-run this after a node upgrade; sh deploy/launchd/uninstall.sh removes it"

if [ "$sync_installed" = yes ]; then
  say "install.sh: installed $SYNC_LABEL, running every $every seconds and at login"
  say "  wrapper  $sync_wrapper"
  say "  plist    $sync_plist"
  say "  log      $sync_log"
  say "  every    $every seconds, from $sync_config"
  say "  the log is shortened to its last 1000 lines once it passes 5000"
else
  say "no sync.json in $config; the sync agent is not installed"
  if [ "$sync_removed" = yes ]; then
    say "  the $SYNC_LABEL it had scheduled was booted out, and its plist and wrapper removed"
  fi
fi
