#!/bin/zsh
set -eu

log_dir="/Volumes/MacMiniExtra/ServiceData/nates-software/rig/logs"
/bin/mkdir -p "${log_dir}"
exec >>"${log_dir}/tunnel.log" 2>>"${log_dir}/tunnel-error.log"

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin"
# tunnel token loaded from Keychain — never in argv (rotate via: security add-generic-password -a "${USER}" -s com.nates-software.rig.tunnel -w "<token>" -U)
export TUNNEL_TOKEN="$(/usr/bin/security find-generic-password -a "${USER}" -s com.nates-software.rig.tunnel -w)"
exec /opt/homebrew/bin/cloudflared tunnel --no-autoupdate run
