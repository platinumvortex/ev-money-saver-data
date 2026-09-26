#!/usr/bin/env bash
# Update the EV Money Saver GitHub Pages tariff feed from a Mac.
#
# Prerequisites:
#   - Node.js 20+ and curl
#   - a clean clone of platinumvortex/ev-money-saver-data
#   - GitHub authentication that can push to main (for example: gh auth login)
#   - CHARGEPRICE_API_KEY set in the environment

set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_key="${CHARGEPRICE_API_KEY:-}"

if [[ -z "$api_key" ]]; then
  printf '%s\n' 'CHARGEPRICE_API_KEY is not set.' >&2
  printf '%s\n' 'Run: export CHARGEPRICE_API_KEY="your-key"' >&2
  exit 1
fi

cd "$repo_dir"

if [[ ! -d .git ]]; then
  printf '%s\n' "This script must run from a clone of the price-feed repository: $repo_dir" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  printf '%s\n' 'Refusing to overwrite a working tree with uncommitted changes.' >&2
  exit 1
fi

branch="$(git branch --show-current)"
if [[ "$branch" != "main" ]]; then
  printf '%s\n' "Expected the main branch, found: $branch" >&2
  exit 1
fi

git pull --ff-only origin main

upstream_file="$(mktemp "${TMPDIR:-/tmp}/ev-money-saver-prices.XXXXXX.json")"
trap 'rm -f "$upstream_file"' EXIT

curl --fail --silent --show-error \
  --header "API-Key: $api_key" \
  --header 'Accept: application/json' \
  'https://api.chargeprice.app/v1/opendata/charging_prices_ch' \
  --output "$upstream_file"

node scripts/build-feed.mjs "$upstream_file" docs/prices.json
npm test

if git diff --quiet -- docs/prices.json; then
  printf '%s\n' 'No tariff changes to publish.'
  exit 0
fi

git add docs/prices.json
git commit -m "Update Swiss charging prices"
git push origin main
printf '%s\n' 'Published updated prices.json. GitHub Actions will deploy the Pages site.'
