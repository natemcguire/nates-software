#!/bin/zsh
set -eu

log_dir="/Volumes/MacMiniExtra/ServiceData/nates-software/rig/logs"
/bin/mkdir -p "${log_dir}"
exec >>"${log_dir}/gateway.log" 2>>"${log_dir}/gateway-error.log"

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin"
export NODE_ENV="production"
export HOST="127.0.0.1"
export PORT="8790"
export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
export RIG_PRODUCTION_ENABLED="true"
export RIG_STATE_PATH="/Volumes/MacMiniExtra/ServiceData/nates-software/rig/instances.json"
export RIG_MAX_INSTANCES_PER_OWNER="2"
export RIG_MAX_TOTAL_INSTANCES="3"
export RIG_GATEWAY_SERVICE_SECRET="$(/usr/bin/security find-generic-password -a "${USER}" -s com.nates-software.rig.gateway -w)"

cd /Volumes/MacMiniExtra/Projects/nates_software
exec /opt/homebrew/bin/node scripts/rig-gateway.mjs
