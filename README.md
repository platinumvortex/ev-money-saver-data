# EV Money Saver data feed

This small GitHub Pages project refreshes the official Swiss eMobility Charging Price Map once per day and publishes `docs/prices.json` for EV Money Saver. The output contains supported CHF direct-payment tariffs only. Subscription, membership, roaming, foreign-currency and unsupported conditional tariffs are omitted.

Source: [Swiss eMobility — Charging Price Map](https://opendata.swiss/en/dataset/ladepreiskarte-swiss-emobility). The O-By-Ask licence requires attribution. Non-commercial use is permitted; obtain Swiss eMobility's prior permission before commercial use.

## Publish it

1. Create the public GitHub repository `platinumvortex/ev-money-saver-data` and push this directory to its default branch.
2. In **Settings → Secrets and variables → Actions**, add the repository secret `CHARGEPRICE_API_KEY`. Obtain access through the source documentation; never commit the key.
3. In **Settings → Pages**, select **GitHub Actions** as the source.
4. Run **Update Swiss charging prices** once from the Actions tab. The scheduled job then runs daily at 03:17 UTC. Without the secret, the workflow publishes the informational page with a waiting status but cannot populate prices.

The published feed URL expected by the extension is:

`https://platinumvortex.github.io/ev-money-saver-data/prices.json`

The workflow uses one upstream request per day, below the documented limit of two requests per 24 hours per IP address. It refuses to publish an empty or structurally invalid feed, so the last successful GitHub Pages deployment remains available if the upstream format changes.

## Update from a Mac

GitHub Actions is already the preferred automatic daily updater. If you want a local backup or a manual refresh, clone this repository on the Mac, authenticate Git, and run:

```sh
cd /path/to/ev-money-saver-data
export CHARGEPRICE_API_KEY='your-key'
./scripts/update-prices-mac.sh
```

The script downloads the upstream response, validates and filters it with the same feed builder used by GitHub Actions, runs the tests, and commits only a changed `docs/prices.json`. The API key is never written to disk or committed. It refuses to run with uncommitted local changes and does not replace the previous feed when the upstream data is invalid.

Do not run this local updater more than once per day: the upstream service documents a two-requests-per-24-hours-per-IP limit. A paid product still requires the source owner's written commercial-use permission.
