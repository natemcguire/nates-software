# SLOPSHOP local feature packages

`slop mod` is a local-only repository mutation command. The browser and edge API
remain preflight-only and never execute package code or write to a Git worktree.

Run it from the target Git worktree:

```sh
slop mod ./feature.json
```

The manifest must use schema version 1 and pin the target repository's current
Git commit. Whole-file changes must include the exact prior content or its
SHA-256 digest for modify/delete operations. Parser-backed transforms can append
statements or replace exactly one named export in JavaScript or TypeScript files.

```json
{
  "schemaVersion": 1,
  "id": "better-score",
  "version": "1.0.0",
  "baseCommitSha": "0123456789abcdef0123456789abcdef01234567",
  "astTransforms": [
    {
      "path": "src/score.ts",
      "operation": "replace_export",
      "exportName": "calculateScore",
      "expectedFileSha256": "sha256:...",
      "content": "export function calculateScore() { return 2; }"
    }
  ]
}
```

The target repository—not the feature package—owns the command used to verify a
change. Configure an argument array in `slop.json`:

```json
{
  "testCommand": ["npm", "test"]
}
```

If `slop.json` is absent, `package.json` must define `scripts.test`. Tests run as
a direct child process without ambient API/cloud credentials. This is not an OS
sandbox: inspect packages before applying them. A failing or unavailable test
causes SLOPSHOP to restore its transaction snapshot unless `--no-rollback` was
explicitly requested.

Success creates local evidence only. Publishing is deliberately separate: review
the diff and use `slop push` for the authenticated GITSMITH CAS boundary.
