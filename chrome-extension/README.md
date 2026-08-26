# C3 Shotgun for Bonzo

One click on any Bonzo prospect fires that lead straight into C3's Shotgun
rotation. The extension only sends the **prospect id** to C3 — C3's server
re-fetches the prospect from the Bonzo API (name, phone, email, state, source,
pipeline), then runs the normal Shotgun publish pipeline: same validation, same
duplicate guard, same CLR rotation and notifications.

## Install (Chrome / Edge)

1. Download `c3-shotgun-extension.zip` from C3 → Shotgun page (or grab this
   folder) and **unzip it**.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped `c3-shotgun-extension` folder.

## Connect it to C3

- **Easiest:** be logged in to C3 (www.westcapitallending.center) in the same
  browser. That's usually all it takes.
- If the extension popup says you're **not connected** even though you're
  logged in: on C3's Shotgun page click **Get my key**, copy the key, open the
  extension's popup (⚡ icon in the toolbar), paste it, Save. The key is shown
  once; generating a new one revokes the old one.
- You need **Shotgun publish access** in C3 (managers have it automatically;
  admins can grant it per-person in Settings → "Allow Shotgun").

## Use

Open any prospect in Bonzo (app.getbonzo.com). An orange **⚡ Shotgun** button
appears bottom-right — it names the prospect once Bonzo has loaded them. Click
it once:

- **Green** — the lead is in the rotation (offered to a ready CLR immediately,
  or queued for the next one).
- **Red** — nothing was published; the button says why (already active in
  Shotgun, no state set on the prospect, not signed in, …). Fix the cause and
  click again.

## Notes for whoever maintains this

- Source of truth lives in the C3 repo under `chrome-extension/`. After any
  edit run `python script/build-extension.py` — it regenerates the icons,
  `hashes.json`, and the downloadable zip in `client/public/`. A test fails if
  the zip is stale.
- The prospect id is captured by hooking `fetch`/XHR in the page (MAIN world)
  and watching for `GET /api(/v3)/prospects/{id}` — no Bonzo URL assumptions.
- Server side lives in `server/routes.ts` (`/api/shotgun/from-bonzo`,
  `/api/shotgun/extension-status`, `/api/shotgun/extension-key`) and
  `server/shotgun-bonzo.ts` + `server/bonzo.ts` (`getProspectDetail`).
