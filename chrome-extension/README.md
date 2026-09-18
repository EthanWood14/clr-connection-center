# C3 ↔ Bonzo Helper

Chrome extension that connects Bonzo to C3 for CLRs:

1. **Log a result** (primary) — step-through wizard on any Bonzo prospect covering
   every Input Results field; submits through the same C3 path as Input Results.
2. **Count Bonzo calls & views** — calls placed in Bonzo, plus unique prospects and
   conversations opened, attributed to the signed-in CLR.
3. **Shotgun** (secondary) — one click sends the on-screen prospect into C3 Shotgun.

## Install (Chrome / Edge)

1. Download `c3-shotgun-extension.zip` from C3 (or grab this folder) and **unzip it**.
2. Open `chrome://extensions`, turn on **Developer mode**.
3. Click **Load unpacked** and pick the folder that has `manifest.json` inside it.

## Connect it to C3

- Be logged in to C3 (www.westcapitallending.center) in the same browser, **or**
- On C3's Shotgun page click **Get my key**, paste it into the extension popup, Save.

## Use

Open any prospect in Bonzo (platform.getbonzo.com):

- **📋 Log result** (blue, primary) — walk through the result wizard and submit.
- **⚡ Shotgun** (orange, secondary) — send the prospect into Shotgun rotation.

The popup shows today's Bonzo call / contact-view / conversation-view counts.

## Maintainer notes

- Source of truth: `chrome-extension/`. After any edit run
  `python script/build-extension.py` — regenerates icons, `hashes.json`, and the
  zip in `client/public/`. A test fails if the zip is stale.
- Extension `manifest.json` version is stamped from the America/Los_Angeles
  calendar day as `YYYY.M.D` (e.g. `2026.9.18`) on every build.
- Call path patterns in `page-hook.js` must stay identical to
  `shared/bonzo-calls.ts` (test-enforced).
- Views report to `POST /api/bonzo-views` (deduped per CLR per target per day).
