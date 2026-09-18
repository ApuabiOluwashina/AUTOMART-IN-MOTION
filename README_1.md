# AutoMart IM Roadside Repairer Network

A small platform that lets auto-repair shops register their location, and
lets drivers find the nearest one on a map during a breakdown — with
Google Sheets (via Apps Script) acting as the database and server, editable
from both the app and the Sheet directly.

## What's in this folder

| File / folder      | Purpose                                                                 |
|---------------------|--------------------------------------------------------------------------|
| `Code.gs`           | Google Apps Script backend — read/write to the Sheet, save uploaded photos to Drive, deployed as a Web App (your "server"). |
| `signup.html`       | Public page where auto-repairers register (name, phone, address → geocoded to lat/lng, services, and a logo/photo uploaded from their device). |
| `map.html`          | Public page for car owners — a proper street map of all **approved** repairers, with "Use my location" to sort by distance and get driving directions. |
| `admin.html`        | Internal AutoMart IM dashboard — **card gallery** (photo/logo, brand name, location, star rating) plus table and map views of all sign-ups; click any repairer for a full detail panel to approve/reject, edit, rate, or delete. Protected by an admin key. |
| `index.html`        | Branded home page linking to the three pages above. |
| `assets/automart-logo.png` | The AutoMart IM logo, shown on every page's header/login screen and as the browser tab icon. |

The resilient map-tile loader (see "Map tiles" below) is **inlined directly
into each of `signup.html`, `map.html`, and `admin.html`** rather than kept
as a separate `tiles.js` file — so a page never loses its map just because
a shared file got left behind while copying, uploading, or hosting. Each
page is fully self-contained other than the logo image and Leaflet's CDN
script.

No build step, no framework — plain HTML/CSS/JavaScript. Maps are rendered
with [Leaflet](https://leafletjs.com/) + free raster tiles, so there's no
Google Maps API key or billing account required.

## How it fits together

```
 Repairer's phone/laptop          Car owner's phone/laptop         AutoMart IM team
 ┌───────────────┐                ┌───────────────┐                ┌───────────────┐
 │  signup.html  │──POST signup──▶│                │                │   admin.html  │
 └───────────────┘                │                │                └───────┬───────┘
                                   │  Code.gs (Apps │                        │ approve/edit/reject
                                   │  Script Web App)│◀──────GET/POST────────┘
 ┌───────────────┐                │       │        │
 │   map.html    │──GET list─────▶│       │        │
 └───────────────┘                └───────┼────────┘
                                           │ reads/writes live
                                           ▼
                                   Google Sheet ("Repairers" tab)
                                   — you can also edit rows here directly —
                                           │
                                           ▼ uploaded photos saved to
                                   Google Drive ("AutoMart IM Repairer Photos" folder)
```

Every request Apps Script handles reads/writes the Sheet live, so the Sheet
is a real two-way database: the app updates it, and you (or your team) can
edit/approve/delete rows directly inside Google Sheets and the app reflects
it immediately on next load.

## Setup (about 10 minutes)

### 1. Create the Google Sheet
1. Create a new Google Sheet.
2. Rename the first tab to exactly: `Repairers`
3. In row 1, add these column headers, in this exact order (A → O):

   ```
   ID | Timestamp | ShopName | ContactName | Phone | Email | Address | Latitude | Longitude | Services | Status | LastUpdated | ImageURL | Rating | RatingCount
   ```

   `ImageURL` holds a link to the shop's photo/logo — filled in automatically
   when a repairer uploads a photo from their device (Code.gs saves it to
   Drive and stores the link here), or your team can paste a link manually
   from the admin dashboard. If it's left blank, the dashboard and public
   map show a colored initials badge instead. `Rating` (0–5) and
   `RatingCount` are set by your team in the admin dashboard as an internal
   quality score — there's no car-owner review flow yet, so these start at
   0 for every new sign-up.

   *(If you already built the Sheet from an earlier version of this project
   with only 12 columns, just add `ImageURL`, `Rating`, and `RatingCount` as
   three new columns at the end — existing rows are unaffected.)*

### 2. Add the Apps Script backend
1. In the Sheet: **Extensions → Apps Script**.
2. Delete any starter code in `Code.gs`, then paste in the contents of this
   folder's `Code.gs`.
3. Set your admin password: **Project Settings** (gear icon, left sidebar) →
   **Script properties** → **Add script property**
   - Property: `ADMIN_KEY`
   - Value: any long random string, e.g. `automart-im-2026-9x7Q`

   This is the password your team will type into `admin.html` to approve or
   edit sign-ups. Anyone without it can only submit sign-ups or view approved
   shops — they can't approve, edit, or delete.

### 3. Deploy it as a Web App
1. Click **Deploy → New deployment**.
2. Type: **Web app**.
3. Execute as: **Me**.
4. Who has access: **Anyone**.
5. Click **Deploy**, then **Authorize access** and approve the permissions.
   This version asks for **Google Drive** access in addition to Sheets —
   that's expected, it's how uploaded repairer photos get stored and
   turned into a shareable link.
6. Copy the **Web app URL** — it looks like:
   `https://script.google.com/macros/s/AKfycb.../exec`

   Whenever you edit `Code.gs` later, go to **Deploy → Manage deployments →
   Edit (pencil) → New version → Deploy** so the change goes live at the
   same URL.

### 4. Point the three pages at your Web App
Open each of `signup.html`, `map.html`, and `admin.html` and replace this
line near the top of the `<script>` section:

```js
const CONFIG = {
  API_URL: "PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE"
};
```

with your actual `/exec` URL from step 3.

### 5. Host the files
Upload this whole folder — all four HTML files and the `assets/` folder
with the logo — to wherever you want to host it: GitHub Pages, your own
domain, Google Sites, Firebase Hosting, etc. They're static files with no
server-side dependency other than the Apps Script Web App, so any static
host works. The only thing that must travel with the HTML files is the
`assets/` folder (for the logo) — the map-tile code is inlined into each
page itself, so there's no separate script file that could get left behind.

### 6. Test it
1. Open `signup.html`, register a test shop — try uploading a photo from
   your device — and confirm you see the success message.
2. Open the Google Sheet — you should see a new row with `Status = Pending`
   and an `ImageURL` pointing to a Google Drive link.
3. Open `admin.html`, enter your `ADMIN_KEY`. The **Cards** view shows the
   test shop as a tile with its photo (or initials), name, address, and
   rating. Click the card to open its full detail panel — set a rating,
   edit any field, and click **Approve**.
4. Open `map.html` — the test shop should now appear as a pin on a proper
   street map. Click "Use my location" to test the nearest-repairer sorting.

## Repairer photos and logos

Repairers can add a shop photo or logo two ways, on `signup.html` (and
admins can do the same when editing a listing from `admin.html`):

- **Upload from device** (primary option) — pick an image file (JPG/PNG, up
  to 3MB); it's converted to base64 in the browser, sent to Apps Script,
  saved into a Google Drive folder called **"AutoMart IM Repairer Photos"**
  (created automatically on first use), shared as "anyone with the link can
  view", and the resulting link is stored in the `ImageURL` column.
- **Paste a photo link** (fallback) — if they'd rather link to a photo
  that's already hosted somewhere (Facebook, Imgur, an existing Drive link,
  etc.), they can paste the URL instead of uploading a file.

If neither is provided, cards and map markers show a colored badge with the
shop's initials instead — there's always something to display.

## Admin dashboard: Cards / Table / Map views

`admin.html` has three interchangeable views (tabs at the top right of the
list), all backed by the same data and filters (search box, and the
All/Pending/Approved/Rejected tabs):

- **Cards** (default) — a visual gallery like an app store listing: each
  repairer is a tile with their photo or a colored initials badge, brand
  name, a short address, and a star rating. Click any card to open its full
  detail panel.
- **Table** — a compact spreadsheet-style list, one row per repairer, with a
  **View / Edit** button that opens the same detail panel.
- **Map** — all sign-ups plotted as color-coded pins (amber = pending,
  green = approved, red = rejected); click a pin to open its detail panel.

The detail panel (opened from any view) shows the shop's full contact
information, a small map of its exact pinned location, its services, and
editable fields for name, phone, address, services, photo (upload or link),
and rating — plus Approve / Reject / Reset to pending / Delete actions.
Edits save straight back to the Google Sheet.

## Map tiles

`signup.html`, `map.html`, and `admin.html` each carry their own copy of
the same resilient tile-loading code (inlined, not a shared file — see
above). Rather than hard-coding one map tile provider, it tries a short
list of free, no-API-key providers in order — currently **Esri World
Street Map** first, falling back to **OpenStreetMap** and then **Wikimedia
Maps** — and automatically swaps to the next one if too many tiles fail to
load.

This exists because free map tile providers occasionally stop working for
reasons outside anyone's control: OpenStreetMap's own volunteer-run servers
block IPs/networks that exceed their usage policy (common on shared
corporate/office networks), and CARTO's free basemaps now require a
signed-up account and API key. If all three listed providers ever stop
working for your network, look for the `TILE_PROVIDERS` array (it's near
the top of the first `<script>` block after the Leaflet `<script>` tag) in
**each of the three files** and add another free provider (or one with an
API key, like [MapTiler](https://www.maptiler.com) or
[Stadia Maps](https://stadiamaps.com)) — since the code is duplicated for
robustness rather than shared, that same edit needs to be made in all
three files to apply everywhere.

## Notes and limitations

- **Geocoding**: `signup.html` uses OpenStreetMap's free Nominatim service
  to turn a typed address into coordinates, with a draggable pin so the
  repairer can fine-tune the exact spot. Nominatim's free tier is meant for
  light, occasional use (no bulk/automated lookups) — fine for a sign-up
  form used by individual shops, but don't wire it up to a script that
  geocodes many addresses in a loop. Repairers can also skip typing an
  address and use "Use my current location" (device GPS) instead.
- **Directions**: "Get directions" links open Google Maps' free directions
  URL scheme (`google.com/maps/dir/?api=1&destination=lat,lng`) in a new
  tab — no API key needed, and it opens turn-by-turn navigation on mobile.
- **Photo storage**: uploaded photos count against your Google Drive
  storage quota (the Google account that owns the Sheet/script), not
  against the repairer's own storage. A handful of shop photos is
  negligible; if the network grows into the thousands of sign-ups, keep an
  eye on Drive storage usage.
- **Admin security**: the `ADMIN_KEY` is a simple shared secret, adequate
  for an internal team tool. It's sent to the Apps Script endpoint on every
  admin request rather than stored server-side as a login session. Don't
  reuse a sensitive password as your `ADMIN_KEY`, and rotate it (update the
  script property) if you ever suspect it's leaked.
- **Approval workflow**: every new sign-up starts as `Pending` and is
  invisible on the public `map.html` until someone on your team clicks
  **Approve** in `admin.html`. This prevents unverified or spam entries
  from reaching car owners.
- **Scaling**: Google Sheets comfortably handles a few thousand rows for
  this kind of use case. If the repairer network grows very large (tens of
  thousands of shops) or you need heavier concurrent traffic, you'd
  eventually want to migrate the backend to a proper database — but for
  launching and validating the idea, Sheets + Apps Script is a solid,
  zero-cost starting point.
