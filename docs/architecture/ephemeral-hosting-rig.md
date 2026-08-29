# RIG.EXE — Runtime-Agnostic Preview and Build Isolation

RIG.EXE runs untrusted application builds and previews. It does not prescribe an application database, filesystem layout, or persistence engine.

## Runtime contract

An application supplies a versioned runtime manifest containing:

- build and start commands;
- runtime/container image digest;
- health check;
- declared ports;
- CPU, memory, and time limits;
- environment-variable names, never secret values;
- optional persistent volume declarations;
- network-egress policy;
- backup/export hooks when the application supports them.

Applications may use SQLite, Postgres, object storage, flat files, browser storage, an external service, or no persistence. SQLite and WAL are application choices, not platform invariants.

## Security boundary

```text
Git commit + runtime manifest
             |
             v
       ephemeral builder ----> immutable build artifacts
             |
             v
       isolated preview
       - no platform secrets
       - restricted egress
       - resource/time limits
       - disposable root filesystem
       - explicitly declared volumes only
```

RIG may snapshot a declared volume through a runtime-specific adapter, but it must not assume that every volume is a database or that every database is SQLite.

## Publication boundary

A preview becoming healthy does not publish a Git ref or production deployment. GITSMITH owns ref publication; the deployment service owns revision activation. RIG returns build and runtime evidence identified by content digests.

