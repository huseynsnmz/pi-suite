#!/usr/bin/env bash
# Applies the protections GitHub only offers on public repositories (or paid
# plans). Run it once, right after making the repository public.
set -euo pipefail
repo="huseynsnmz/pi-memory"

gh api -X POST "repos/$repo/rulesets" --input - <<'JSON'
{
  "name": "protect-main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [{ "type": "deletion" }, { "type": "non_fast_forward" }]
}
JSON

gh api -X POST "repos/$repo/rulesets" --input - <<'JSON'
{
  "name": "immutable-release-tags",
  "target": "tag",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } },
  "rules": [{ "type": "deletion" }, { "type": "update" }, { "type": "non_fast_forward" }]
}
JSON

gh api -X PUT "repos/$repo/private-vulnerability-reporting"
gh api -X PATCH "repos/$repo" --input - <<'JSON'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
JSON
gh api -X PUT "repos/$repo/vulnerability-alerts"
gh api -X PATCH "repos/$repo" --input - <<'JSON'
{ "has_wiki": false, "has_projects": false, "delete_branch_on_merge": true }
JSON
gh api -X PATCH "repos/$repo" -f pull_request_creation_policy=collaborators_only >/dev/null \
  || echo "Turn pull requests off by hand in the repository's settings."
echo "Protections applied to $repo."
