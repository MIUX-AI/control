#!/usr/bin/env bash
set -euo pipefail

REMOTE_URL="${1:-}"
if [ -z "$REMOTE_URL" ]; then
  echo "Usage: bash push_to_github.sh <remote-url>"
  echo "Example: bash push_to_github.sh https://github.com/USERNAME/klingprojek-vercel.git"
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required but not found"
  exit 1
fi

if [ ! -d .git ]; then
  git init -b main
fi

if ! git config user.name >/dev/null 2>&1; then
  echo "Git user.name is not set. Example: git config --global user.name 'Your Name'"
  exit 1
fi

if ! git config user.email >/dev/null 2>&1; then
  echo "Git user.email is not set. Example: git config --global user.email 'you@example.com'"
  exit 1
fi

git add .

if git diff --cached --quiet; then
  echo "No staged changes to commit. Continuing to remote setup."
else
  git commit -m "Initial Vercel-ready import"
fi

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE_URL"
else
  git remote add origin "$REMOTE_URL"
fi

git push -u origin main
