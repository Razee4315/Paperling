#!/usr/bin/env bash
# Fetch upstream and start a sync branch on top of it.
#
# It never commits and never pushes: it leaves conflicts (if any) for you to
# resolve, following the playbook in UPSTREAM.md. Re-run-safe: if the branch
# already exists it is reused.
#
#   bash scripts/upstream-sync.sh                 # branch chore/upstream-sync-<today>
#   bash scripts/upstream-sync.sh my-branch-name
set -euo pipefail

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
BRANCH="${1:-chore/upstream-sync-$(date +%F)}"

cd "$(git rev-parse --show-toplevel)"

if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
    echo "Adding '$UPSTREAM_REMOTE' -> github.com/Razee4315/Paperling (push disabled)..."
    git remote add "$UPSTREAM_REMOTE" https://github.com/Razee4315/Paperling.git
    git remote set-url --push "$UPSTREAM_REMOTE" "DISABLED://never-push-to-upstream"
fi

echo "Fetching $UPSTREAM_REMOTE..."
if ! git fetch "$UPSTREAM_REMOTE"; then
    echo "error: could not fetch '$UPSTREAM_REMOTE' (network?). Not merging anything." >&2
    exit 1
fi

incoming=$(git rev-list --count "HEAD..$UPSTREAM_REMOTE/main")
echo
echo "Upstream commits not in HEAD: $incoming"
if [ "$incoming" -gt 0 ]; then
    git --no-pager log --oneline "HEAD..$UPSTREAM_REMOTE/main" | head -20
fi

if [ "$incoming" -eq 0 ]; then
    echo "Already up to date with $UPSTREAM_REMOTE/main."
    exit 0
fi

echo
echo "Creating '$BRANCH' and merging $UPSTREAM_REMOTE/main..."
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git checkout "$BRANCH"
else
    git checkout -b "$BRANCH"
fi
git merge "$UPSTREAM_REMOTE/main" || true

echo
if git diff --name-only --diff-filter=U | grep -q .; then
    echo "Conflicts to resolve:"
    git --no-pager diff --name-only --diff-filter=U | sed 's/^/  /'
    echo
    echo "Playbook: UPSTREAM.md - take upstream's structure, re-apply our t() calls."
    echo "Then verify:"
    echo "  node node_modules/typescript/bin/tsc --noEmit"
    echo "  node node_modules/vitest/vitest.mjs run"
else
    echo "Merged cleanly. Verify (tsc + vitest), then commit and push '$BRANCH'."
fi
