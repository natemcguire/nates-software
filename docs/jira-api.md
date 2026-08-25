# JIRA API Reference (sailscan.atlassian.net)

Hard-won knowledge for working with our JIRA via REST v3. Used to set up the NB board; reuse for any new project.

## Setup / Auth

- **Auth**: Basic auth over REST v3 — `Authorization: Basic base64(email:api_token)`. The email must be the Atlassian account email (`nate.mcguire@gmail.com`, NOT a domain email — wrong email gives 401).
- **Site discovery**: probe `https://<site>.atlassian.net/rest/api/3/myself` — 200 confirms site + credentials; 404 = wrong site, 401 = wrong email/token pair.
- Config in `~/.config/keys/keys.env`: `JIRA_SITE=https://sailscan.atlassian.net`, `JIRA_EMAIL`, `JIRA_API_TOKEN`. (`source` with `set -a` so child processes see them.)

## Core endpoints that work

- **List projects**: `GET /rest/api/3/project/search`
- **Create team-managed project**: `POST /rest/api/3/project` with `{"key","name","projectTypeKey":"software","projectTemplateKey":"com.pyxis.greenhopper.jira:gh-simplified-agility-kanban","leadAccountId":...}` — verified working. Confirm afterwards that `GET /rest/api/3/project/{KEY}` returns `"style":"next-gen"`.
- **Project statuses per issue type**: `GET /rest/api/3/project/{KEY}/statuses`
- **Project issue types**: `GET /rest/api/3/issuetype/project?projectId={id}`
- **Create issue**: `POST /rest/api/3/issue` — description must be **ADF**, not plain text: `{"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"..."}]}]}`. Labels can't contain spaces.
- **Search**: `POST /rest/api/3/search/jql` (newer endpoint) with `{"jql":"...","fields":[...],"maxResults":N}`
- **Edit fields**: `PUT /rest/api/3/issue/{key}` — labels via `{"update":{"labels":[{"add":"x"}]}}`
- **Comments**: `POST /rest/api/3/issue/{key}/comment` (ADF body)
- **Status changes**: CANNOT be set via issue edit. `GET /rest/api/3/issue/{key}/transitions` for IDs, then `POST` same endpoint with `{"transition":{"id":"..."}}`. Team-managed transitions are GLOBAL (any→any), so one issue's ID map works for every issue in the project.
- **Rename a status**: `PUT /rest/api/3/statuses` with `{"statuses":[{"id":"10004","name":"New Name","statusCategory":"TODO"}]}` — team-managed statuses are project-scoped, so renames are safe.
- **Create statuses**: `POST /rest/api/3/statuses` with `{"scope":{"type":"PROJECT","project":{"id":"..."}},"statuses":[{"name":"...","statusCategory":"TODO|IN_PROGRESS|DONE","description":""}]}` — creates but does NOT add to any workflow.

## Adding statuses to a team-managed workflow (the hard part)

`POST /rest/api/3/workflows/update` is the only way. The docs are unhelpful; the answer is in the swagger spec (`dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json`).

1. Read the workflow: `POST /rest/api/3/workflows` with `{"projectAndIssueTypes":[{"projectId":"...","issueTypeId":"..."}]}` → workflow `id`, `version`, `statuses` (bare `statusReference` entries; names live in the top-level `statuses` array of the response), `transitions`.
2. In the update payload, the top-level `statuses` array lists ALL statuses used after the update, each with `statusReference`, `name`, `statusCategory`, `id`. **Critical**: statuses NEW to the workflow need a fresh **client-generated UUID** as `statusReference`, with `id` set to the existing numeric status id to reuse it. Existing in-workflow statuses keep their numeric references.
3. The workflow-level `statuses` array (bare `{"statusReference"}` entries) defines board column order.
4. Add a GLOBAL transition per new status (same name as the status), with `actions/validators/triggers: []`.
5. **Omit `statusMappings` entirely** when only adding — mappings are only required for *removed* statuses; empty ones fail with misleading circular errors.
6. The board **auto-creates columns** mirroring the workflow — never hand-edit columns for status changes. Caveat: newly added statuses get their columns **appended in creation order**, not in the workflow's `statuses` array order, and there is no API (and no reliable automation) to reorder columns — drag them once manually in the board UI.

Working implementation of all of the above: `scripts/jira/` (setup + seed scripts from the NB board setup).

## Project access levels (team-managed) — internal API

There is NO public API for a team-managed project's access level (Open/Limited/Private). The internal endpoint works with normal Basic auth:

- **Read**: `GET /rest/internal/simplified/1.0/projects/{numericProjectId}/summary` → includes `accessLevel.value` (`OPEN|LIMITED|PRIVATE`). Numeric id only — the key 400s.
- **Change**: `PUT` the same URL with `{"accessLevel":"PRIVATE"}` (or `OPEN`/`LIMITED`).
- **Add people to a project**: public API — `POST /rest/api/3/project/{key}/role/{roleId}` with `{"user":["<accountId>", ...]}`; get role ids from `GET /rest/api/3/project/{key}/role` (team-managed roles: Administrator, Member, Viewer).
- Current setup (2026-08-21): SAIL is OPEN with Alex + JRo as Members; NB and DOS are PRIVATE (Nate only).

## Misc

- Project style check: `GET /rest/api/3/project/{KEY}` → `"style":"next-gen"` = team-managed (different workflow rules than company-managed).
- Board config (read-only): `GET /rest/agile/1.0/board?projectKeyOrId=KEY` then `/rest/agile/1.0/board/{id}/configuration` — no write API for columns.
- Rate limiting: ~0.12–0.15s sleeps between calls handled ~100-issue batches with zero errors.
