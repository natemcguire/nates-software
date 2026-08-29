# RIG production host

The Mac mini runs the Docker-backed RIG provider behind a named Cloudflare Tunnel. The gateway binds only to `127.0.0.1:8790`; Cloudflare is the sole public ingress at `https://rig-provider.nates-software.com`.

## Durable paths

- Repository and service scripts: `/Volumes/MacMiniExtra/Projects/nates_software`
- Registry: `/Volumes/MacMiniExtra/ServiceData/nates-software/rig/instances.json`
- Logs: `/Volumes/MacMiniExtra/ServiceData/nates-software/rig/logs`
- Colima VM and Docker data: `/Volumes/MacMiniExtra/HomeData/.colima`

The registry is written atomically with mode `0600`. RIG application storage remains application-defined; the provider does not impose SQLite, WAL, or any other database.

## Secrets and services

The launch scripts read credentials from macOS Keychain services rather than files or plist environment variables:

- `com.nates-software.rig.gateway`
- `com.nates-software.rig.tunnel`

Installed user launch agents:

- `com.nates-software.rig-gateway`
- `com.nates-software.rig-tunnel`

The host currently declares a conservative limit of two active instances per owner and three total instances. Every container remains bounded to at most 256 MiB, one hour, non-root execution, a read-only root filesystem, dropped capabilities, no-new-privileges, bounded PIDs/CPU, immutable image digests, and no Docker socket or host bind mounts.

## Verification

```bash
curl -fsS http://127.0.0.1:8790/healthz
curl -fsS http://127.0.0.1:8790/capabilities
launchctl print "gui/$(id -u)/com.nates-software.rig-gateway"
launchctl print "gui/$(id -u)/com.nates-software.rig-tunnel"
docker ps --filter label=rig.managed=true
```

Do not expose port 8790 or the container port range directly. Do not put either service credential in the repository, launch plists, shell profiles, or logs.
