#!/usr/bin/env bash
# Push the complete project to GitHub (DuoLE3383/Elliot).
# Usage: GITHUB_TOKEN=<token> bash /home/z/my-project/scripts/push-to-github.sh
#
# NOTE: remote main currently holds an unrelated history (a 60MB workspace tar
# backup, safely kept at /tmp/HEAD.tar), so this uses --force to replace it
# with the real project history. Token is never echoed to output.

set -euo pipefail

TOKEN="${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
REPO="DuoLE3383/Elliot"
MASK='s/x-access-token:[^@[:space:]]*/x-access-token:***/g; s/ghp_[A-Za-z0-9_]*/ghp_***/g; s/github_pat_[A-Za-z0-9_]*/github_pat_***/g'

cd /home/z/my-project

echo "==> Pushing main -> https://github.com/${REPO} (force, replaces tar backup)"
git push --force "https://x-access-token:${TOKEN}@github.com/${REPO}.git" main:main 2>&1 | sed -E "$MASK"

echo "==> Verifying remote state"
GIT_TERMINAL_PROMPT=0 git ls-remote "https://x-access-token:${TOKEN}@github.com/${REPO}.git" refs/heads/main 2>&1 | sed -E "$MASK"

echo "==> Done. Local HEAD: $(git rev-parse --short HEAD)"
