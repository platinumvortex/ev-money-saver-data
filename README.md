# EV Money Saver data feed

This small GitHub Pages project refreshes Swiss charging prices and the federal Swiss charging-station catalogue once per day. It publishes:

- `prices-v2.json`: every supported CHF ad-hoc tariff from all sources, keyed by federal EVSE ID (used by EV Money Saver 1.11+).
- `prices.json`: version 1, Swiss eMobility direct-payment tariffs only, unchanged for installed 1.10.x extensions.
- `stations.json`: the validated federal station catalogue.

Subscription, membership, roaming, foreign-currency and unsupported conditional tariffs are omitted.

## Price sources (`prices-v2.json`)

| Source | What is included | Match |
| --- | --- | --- |
| Swiss eMobility Charging Price Map (Chargeprice open data) | Direct-payment tariffs; Swisscharge and Electra free-app tariffs | EVSE ID |
| eCarUp public map (daily crawl of Swiss stations) | Energy price, hourly parking fee, blocking fee after a grace period | Hubject ID = EVSE ID |
| Fastned, Migrol (M-Charge) tariff pages | Published standard ad-hoc price by power band | Operator + power |

Each source fails independently: a failed or collapsed source (under half its previous size) keeps its previous tariffs while they are under six days old, with their original `verifiedAt`, and its status becomes `carried`. The build refuses to publish fewer than 1,000 tariffs. Run it locally with Node 20:

```sh
node scripts/build-v2.mjs --stations sfoe.json --chargeprice upstream.json --out docs/prices-v2.json
```

Every run also force-pushes the three feed files to the `feed` branch, which jsDelivr serves as an independent mirror (`https://cdn.jsdelivr.net/gh/platinumvortex/ev-money-saver-data@feed/prices-v2.json`), and re-enables the workflow's own schedule so GitHub's 60-day inactivity rule cannot switch off the daily refresh.

Source: [Swiss eMobility — Charging Price Map](https://opendata.swiss/en/dataset/ladepreiskarte-swiss-emobility). The O-By-Ask licence requires attribution. Non-commercial use is permitted; obtain Swiss eMobility's prior permission before commercial use.

## Publish it

1. Create the public GitHub repository `platinumvortex/ev-money-saver-data` and push this directory to its default branch.
2. In **Settings → Secrets and variables → Actions**, add the repository secret `CHARGEPRICE_API_KEY`. Obtain access through the source documentation; never commit the key.
3. In **Settings → Pages**, select **GitHub Actions** as the source.
4. Run **Update Swiss charging prices** once from the Actions tab. The scheduled job then runs daily at 03:17 UTC. Without the secret, the workflow publishes the informational page with a waiting status but cannot populate prices.

The published feed URL expected by the extension is:

`https://platinumvortex.github.io/ev-money-saver-data/prices.json`

The station feed is published at:

`https://platinumvortex.github.io/ev-money-saver-data/stations.json`

The workflow uses one price request per day, below the documented limit of two requests per 24 hours per IP address. It validates both feeds and refuses to publish an empty, partial or structurally invalid result, so the last successful GitHub Pages deployment remains available if either upstream format changes.

## Update from a Mac

GitHub Actions is already the preferred automatic daily updater. If you want a local backup or a manual refresh, clone this repository on the Mac, authenticate Git, and run:

```sh
cd /path/to/ev-money-saver-data
export CHARGEPRICE_API_KEY='your-key'
./scripts/update-prices-mac.sh
```

For an unattended Mac run, save the key once in the logged-in user's Keychain instead of placing it in a shell profile or scheduler file:

```sh
security add-generic-password -a "$USER" -s 'EV Money Saver Chargeprice API Key' -w 'your-key' -U
```

The script then reads that Keychain entry automatically. It downloads the upstream response, validates and filters it with the same feed builder used by GitHub Actions, runs the tests, and commits only a changed `docs/prices.json`. The API key is never written to disk or committed. It refuses to run with uncommitted local changes and does not replace the previous feed when the upstream data is invalid.

Do not run this local updater more than once per day: the upstream service documents a two-requests-per-24-hours-per-IP limit. A paid product still requires the source owner's written commercial-use permission.
