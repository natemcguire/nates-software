#!/bin/zsh
set -eu

log_dir="/Volumes/MacMiniExtra/ServiceData/nates-software/rig/logs"
/bin/mkdir -p "${log_dir}"
exec >>"${log_dir}/tunnel.log" 2>>"${log_dir}/tunnel-error.log"

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin"
tunnel_token="$(/usr/bin/security find-generic-password -a "${USER}" -s com.nates-software.rig.tunnel -w)"
exec /opt/homebrew/bin/cloudflared tunnel --no-autoupdate run --token "${tunnel_token}"
