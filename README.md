# AutoMart IM Roadside Repairer Network

A small platform that lets auto-repair shops (and mobile mechanics with no
fixed shop) register their location, and lets drivers find the nearest one
on a map during a breakdown — see their rating, distance, and price, and pay
to book them on the spot via Paystack. Google Sheets (via Apps Script) acts
as the database and server, editable from both the app and the Sheet
directly.

## What's in this folder

| File / folder      | Purpose                                                                 |
|---------------------|--------------------------------------------------------------------------|
| `Code.gs`           | Google Apps Script backend — read/write to the Sheet, save uploaded photos to Drive, verify Paystack payments, deployed as a Web App (your "server"). |
| `signup.html`       | Public page where auto-repairers register (name, phone, address → geocoded to lat/lng, services, a logo/photo uploaded from their device, and — optionally — "mobile mechanic" mode with a callout price). |
| `map.html`          | Public page for car owners — a proper street map of all **approved** repairers, with "Use my location" to sort by distance, see an estimated drive time and rating, and get directions. |
| `profile.html`      | Public profile page for **one** repairer (opened from `map.html`) — photo, rating breakdown chart, services, price, a mini map, distance/ETA from the car owner, a "Pay & Book" button (Paystack), and a place for car owners to leave and read star ratings + written reviews. |
| `update-location.html` | A repairer's personal, no-login page to update their live location and "available now" status from their phone — this is the "mobile" part of "mobile mechanic." |
| `admin.html`        | Internal AutoMart IM dashboard — **card gallery** (photo/logo, brand name, location, star rating, mobile/price badges) plus table, map, and **bookings** views of all sign-ups and payments; click any repairer for a full detail panel to approve/reject, edit, rate, delete, or moderate (delete) their reviews. Protected by an admin key. |
| `index.html`        | Branded home page linking to the pages above. |
| `assets/automart-logo.png` | The AutoMart IM logo, shown on every page's header/login screen and as the browser tab icon. |

The resilient map-tile loader (see "Map tiles" below) is **inlined directly
into each page that shows a map** (`signup.html`, `map.html`, `admin.html`,
`profile.html`) rather than kept as a separate `tiles.js` file — so a page
never loses its map just because a shared file got left behind while
copying, uploading, or hosting. Each page is fully self-contained other than
the logo image and Leaflet's/Paystack's CDN scripts.

No build step, no framework — plain HTML/CSS/JavaScript. Maps are rendered
with [Leaflet](https://leafletjs.com/) + free raster tiles, so there's no
Google Maps API key or billing account required.

## How it fits together

```
 Repairer's phone/laptop            Car owner's phone/laptop           AutoMart IM team
 ┌────────────────────┐             ┌───────────────┐                  ┌───────────────┐
 │    signup.html      │──POST signup──▶                                │   admin.html  │
 │ update-location.html│──POST update_location──▶                       └───────┬───────┘
 └────────────────────┘             │  Code.gs (Apps │                          │ approve/edit/reject
                                     │  Script Web App)│◀───────GET/POST─────────┘
 ┌───────────────┐                  │       │        │
 │   map.html     │──GET list──────▶│       │        │
 │ profile.html   │──GET get_repairer / POST verify_payment──▶
 └───────────────┘                  └───────┼────────┘
                                             │ reads/writes live
                                             ▼
                                     Google Sheet ("Repairers" tab, "Bookings" tab)
                                     — you can also edit rows here directly —
                                             │
                                             ├─▶ uploaded photos saved to Google Drive
                                             │   ("AutoMart IM Repairer Photos" folder)
                                             └─▶ payments verified against Paystack's API
```

Every request Apps Script handles reads/writes the Sheet live, so the Sheet
is a real two-way database: the app updates it, and you (or your team) can
edit/approve/delete rows directly inside Google Sheets and the app reflects
it immediately on next load.

## Setup (about 15 minutes)

### 1. Create the Google Sheet
1. Create a new Google Sheet.
2. Rename the first tab to exactly: `Repairers`
3. In row 1, add these column headers, in this exact order (A → S):

   ```
   ID | Timestamp | ShopName | ContactName | Phone | Email | Address | Latitude |
   Longitude | Services | Status | LastUpdated | ImageURL | Rating | RatingCount |
   IsMobile | MobileServices | CalloutPrice | AvailableNow
   ```

   `ImageURL` holds a link to the shop's photo/logo — filled in automatically
   when a repairer uploads a photo from their device (Code.gs saves it to
   Drive and stores the link here), or your team can paste a link manually
   from the admin dashboard. If it's left blank, the dashboard and public
   map show a colored initials badge instead. `Rating` (0–5) and
   `RatingCount` start at 0 for every new sign-up, and can be set manually
   by your team in the admin dashboard as a starting score — but once any
   car owner leaves a real review on `profile.html`, both columns are
   recalculated automatically from the `Reviews` tab (see "Ratings and
   reviews" below) and will overwrite a manual value on the next review.

   The four new columns power the "mobile mechanic" and payment features:
   `IsMobile` (TRUE/FALSE — no fixed shop, travels to customers),
   `MobileServices` (comma-separated light/roadside jobs), `CalloutPrice`
   (the ₦ amount shown on the public profile and charged via Paystack), and
   `AvailableNow` (TRUE/FALSE — toggled by the repairer from
   `update-location.html`, defaults to TRUE).

   *(Upgrading an existing Sheet from an earlier version of this project?
   Just add whichever of `ImageURL`, `Rating`, `RatingCount`, `IsMobile`,
   `MobileServices`, `CalloutPrice`, `AvailableNow` are missing, as new
   columns at the end, in that order. Existing rows are unaffected — they'll
   read as blank/0/false until a repairer edits their listing.)*

4. A second tab named **`Bookings`** is created automatically the first
   time someone pays via Paystack (or the first time you open the admin
   dashboard's Bookings view) — you don't need to create it by hand. Its
   columns, if you're curious or want to build reports on it: `Reference |
   RepairerID | ShopName | PayerName | PayerPhone | Amount | Status |
   Timestamp`.
5. A third tab named **`Reviews`** is likewise created automatically the
   first time a car owner submits a rating on `profile.html`. Its columns:
   `ID | RepairerID | CarOwnerName | Stars | ReviewText | HelpfulCount |
   Timestamp`. See "Ratings and reviews" below for how this feeds the
   `Rating`/`RatingCount` columns on the Repairers tab.

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
4. (Optional, for payments) Add a second script property:
   - Property: `PAYSTACK_SECRET_KEY`
   - Value: your Paystack **secret** key (starts with `sk_`), from your
     Paystack dashboard → Settings → API Keys & Webhooks.

   This lets Apps Script confirm with Paystack's own servers that a payment
   really succeeded before it's recorded as a booking — see "Payments
   (Paystack)" below. You can skip this step and add it later; until it's
   set, `profile.html` will show a clear "payments not configured yet"
   message instead of a broken button.

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

### 4. Point every page at your Web App (and Paystack)
Open `signup.html`, `map.html`, `admin.html`, `profile.html`, and
`update-location.html`, and replace this line near the top of the
`<script>` section of each:

```js
const CONFIG = {
  API_URL: "PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE"
};
```

with your actual `/exec` URL from step 3. In `profile.html` only, also
paste your Paystack **public** key (starts with `pk_`, safe to expose in
the browser) into `CONFIG.PAYSTACK_PUBLIC_KEY`.

### 5. Host the files
Upload this whole folder — all the HTML files and the `assets/` folder
with the logo — to wherever you want to host it: GitHub Pages, your own
domain, Google Sites, Firebase Hosting, etc. They're static files with no
server-side dependency other than the Apps Script Web App, so any static
host works. The only thing that must travel with the HTML files is the
`assets/` folder (for the logo) — the map-tile code is inlined into each
page itself, so there's no separate script file that could get left behind.

### 6. Test it
1. Open `signup.html`, register a test shop — try uploading a photo from
   your device, and try checking "I'm a mobile repairer" to see the extra
   fields — and confirm you see the success message with your personal
   `update-location.html` link.
2. Open the Google Sheet — you should see a new row with `Status = Pending`
   and an `ImageURL` pointing to a Google Drive link.
3. Open `admin.html`, enter your `ADMIN_KEY`. The **Cards** view shows the
   test shop as a tile with its photo (or initials), name, address, rating,
   and mobile/price badges. Click the card to open its full detail panel —
   set a rating, edit any field, and click **Approve**.
4. Open `map.html` — the test shop should now appear as a pin on a proper
   street map, with its rating, distance, and an estimated drive time once
   you click "Use my location." Click "View profile & book" to open
   `profile.html`.
5. On `profile.html`, if you set a callout price, try the "Pay & Book"
   button (use Paystack's test mode / test card first — see their docs) and
   confirm a row appears in the new **Bookings** tab of the Sheet, and in
   `admin.html`'s Bookings view.
6. Open the personal link from step 1 (`update-location.html?id=...`),
   toggle "Available now," and click "Update My Location Now" — confirm the
   Sheet's `Latitude`/`Longitude`/`AvailableNow` update.
7. Back on `profile.html`, tap a star rating, add a short review, and
   submit — confirm a new row appears in the **Reviews** tab, and that the
   breakdown chart, average, and the shop's `Rating`/`RatingCount` on the
   Repairers tab all update. Then open the repairer's detail panel in
   `admin.html` and confirm the review shows up there too, with a working
   Delete button.

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

If neither is provided, cards, map markers, and the profile page show a
colored badge with the shop's initials instead — there's always something
to display.

## Mobile mechanics (no fixed shop)

A repairer without a workshop can still join the network by checking "I'm a
mobile repairer" on `signup.html`. This unlocks:

- A **mobile services** checklist — light, roadside-friendly jobs (battery
  jump-start, tyre change, fuel delivery, lockouts, basic diagnostics,
  towing) shown separately from full workshop services on their profile.
- A **callout/service price**, shown on `map.html` and `profile.html` as
  "From ₦X," which is what car owners pay through Paystack to book them.
- Their personal **`update-location.html?id=...`** link, shown once right
  after sign-up (and recoverable later by phone number from the "Find my
  link" form on that same page if it's not opened with an `id`). This page
  needs no login: the repairer taps **"📍 Update My Location Now,"** the
  browser asks for GPS permission, and their position on the public map
  updates immediately — this is deliberately a manual, one-tap refresh
  rather than continuous background tracking, so it works reliably on any
  phone without draining battery or needing the tab to stay open. The same
  page has an **"Available now"** switch so a mobile mechanic can mark
  themselves unavailable without losing their spot in the directory.

A fixed-shop repairer can also use `update-location.html` if they ever need
to correct their pin (e.g. after actually moving premises), and can toggle
availability the same way — it isn't exclusive to mobile mechanics.

## Distance, ETA, and ratings on the map

When a car owner clicks "Use my location" on `map.html` (or "Distance from
me" on `profile.html`), each nearby repairer's card shows:

- **Distance** — straight-line ("as the crow flies") kilometres between the
  car owner and the repairer, using the Haversine formula.
- **Estimated drive time** — that distance divided by an assumed average
  road speed (35 km/h, tuned for mixed urban/breakdown driving), clearly
  labelled "(estimate)." This is a free, no-API-key approximation, not real
  turn-by-turn routing — actual driving time varies with traffic and road
  conditions, which is why "Get directions" (real Google Maps routing) is
  always offered alongside it.
- **Overall rating** — the live star rating and review count (see "Ratings
  and reviews" below).
- **Geolocation address** — the repairer's registered address (or, for a
  mobile mechanic, their base area, clearly labelled "Mobile mechanic").

## Ratings and reviews

`profile.html` has a full ratings section, similar to an app store listing:

- A **big average rating** (e.g. "4.6") with its star icons and total
  review count.
- A **5-star breakdown chart** — a bar for each star value (5★ down to 1★)
  showing how many reviews gave that rating, so a car owner can see at a
  glance whether a high average comes from many consistent reviews or a
  handful of extremes.
- A **"How would you rate this repairer?"** form — any car owner can tap a
  star rating (required) and optionally add their name and a written
  review, with no login needed. Submitting posts immediately; there's no
  approval queue before it's publicly visible (spam/abuse is handled by
  after-the-fact moderation, below).
- A **review list** (newest first, paginated "Show more") with a 👍
  **Helpful** button per review, similar to the reference design.

Whenever a review is submitted or deleted, the repairer's `Rating` and
`RatingCount` columns on the **Repairers** sheet tab are automatically
recalculated as the live average/count of everything in the **Reviews**
tab — this is the same `Rating`/`RatingCount` shown on `map.html`'s cards
and `admin.html`'s card gallery, so it's always in sync everywhere.

**Moderation**: reviews go live immediately with no pre-approval, which
keeps the experience frictionless but means a spam or abusive review can
appear before your team sees it. To handle that, open any repairer's detail
panel in `admin.html` — a **Reviews** section near the bottom lists every
review for that repairer with a **Delete** button. Deleting a review
removes it permanently and immediately recalculates that repairer's
rating. There's currently no profanity filter or automated spam detection;
this is a manual, after-the-fact moderation tool, which is appropriate for
a small/early network but worth revisiting (e.g. adding review reporting,
or requiring a completed booking before a review can be left) as the
platform grows.

## Payments (Paystack)

`profile.html` shows a **"Pay & Book"** button whenever a repairer has set a
`CalloutPrice`. The flow:

1. The car owner enters their name, phone, and email, and clicks Pay.
2. Paystack's own popup (loaded from `js.paystack.co`) handles the actual
   card/transfer entry — no card details ever touch AutoMart IM's servers.
3. On success, the browser sends Paystack's transaction **reference** to
   Apps Script (`verify_payment` action), which calls Paystack's
   `GET /transaction/verify/:reference` endpoint **using your secret key,
   server-side** — this is the step that actually confirms the money moved,
   rather than trusting whatever the browser reports (a browser can be
   tampered with; Paystack's own server can't be).
4. Once verified, the booking is logged as a new row in the **Bookings**
   sheet tab (reference, repairer, payer name/phone, amount, status,
   timestamp), visible in `admin.html`'s **💳 Bookings** view.

If `PAYSTACK_SECRET_KEY` hasn't been set as a script property yet, the pay
button still shows, but attempting to verify a payment returns a clear
"payments are not configured yet" message instead of silently failing.
Nothing about receiving payments requires Paystack keys to be present for
the rest of the platform (sign-up, the map, admin) to work.

## Admin dashboard: Cards / Table / Map / Bookings views

`admin.html` has four interchangeable views (tabs at the top right of the
list), the first three backed by the same data and filters (search box, and
the All/Pending/Approved/Rejected tabs):

- **Cards** (default) — a visual gallery like an app store listing: each
  repairer is a tile with their photo or a colored initials badge, brand
  name, a short address, a star rating, and Mobile/Price/Available badges.
  Click any card to open its full detail panel.
- **Table** — a compact spreadsheet-style list, one row per repairer, with a
  **View / Edit** button that opens the same detail panel.
- **Map** — all sign-ups plotted as color-coded pins (amber = pending,
  green = approved, red = rejected); click a pin to open its detail panel.
- **Bookings** — every Paystack payment that's been verified: reference,
  repairer, payer name/phone, amount, status, and when it happened. This is
  read-only here; the source of truth is the `Bookings` sheet tab.

The detail panel (opened from any of the first three views) shows the
shop's full contact information, a small map of its exact pinned location,
its services, editable fields for name, phone, address, services, photo
(upload or link), rating, mobile-repairer status, mobile services, callout
price, and availability, and a **Reviews** list for that repairer with a
Delete button on each one for moderation — plus Approve / Reject / Reset to
pending / Delete actions. Edits save straight back to the Google Sheet.

## Map tiles

`signup.html`, `map.html`, `admin.html`, and `profile.html` each carry their
own copy of the same resilient tile-loading code (inlined, not a shared
file — see above). Rather than hard-coding one map tile provider, it tries a
short list of free, no-API-key providers in order — currently **Esri World
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
**each of the four files** and add another free provider (or one with an
API key, like [MapTiler](https://www.maptiler.com) or
[Stadia Maps](https://stadiamaps.com)) — since the code is duplicated for
robustness rather than shared, that same edit needs to be made in all four
files to apply everywhere.

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
- **ETA is an estimate, not real routing**: distances and drive times shown
  on `map.html`/`profile.html` are straight-line distance ÷ an assumed
  average speed, computed entirely in the browser for free. It won't match
  Google's routed driving time, especially where roads are indirect or
  congested — it's meant as a rough "how far, roughly how long" signal, not
  a promise. If you later want real driving-time routing, a free option is
  self-hosting or calling a public [OSRM](http://project-osrm.org/) demo
  server; that's a bigger change than this project currently makes.
- **Location updates are manual, not continuous**: `update-location.html`
  takes a single GPS fix each time the repairer taps the button — there's
  no background tracking while a tab is open. This is deliberate: it needs
  no special permissions beyond a one-time location prompt, doesn't drain
  battery, and works the same whether the repairer has the page open for
  five seconds or five hours.
- **Security notes**: the `ADMIN_KEY` is a simple shared secret, adequate
  for an internal team tool — it's sent to the Apps Script endpoint on
  every admin request rather than stored server-side as a login session.
  Don't reuse a sensitive password as your `ADMIN_KEY`, and rotate it
  (update the script property) if you ever suspect it's leaked. In the same
  spirit, a repairer's **ID** (a long, random, hard-to-guess UUID) doubles
  as their personal access token for `update-location.html` — whoever has
  that exact link can update that one repairer's location and availability,
  with no username/password. This is a deliberate, low-friction tradeoff
  (repairers won't need to remember a password to update their location
  from the road) rather than enterprise-grade authentication; it's
  appropriate for an internal/trusted network but means the link itself
  should be treated like a password and not posted publicly. `PAYSTACK_SECRET_KEY`
  never leaves the Apps Script project — it's only used server-side to
  verify payments, never sent to any browser.
- **Photo storage**: uploaded photos count against your Google Drive
  storage quota (the Google account that owns the Sheet/script), not
  against the repairer's own storage. A handful of shop photos is
  negligible; if the network grows into the thousands of sign-ups, keep an
  eye on Drive storage usage.
- **Approval workflow**: every new sign-up starts as `Pending` and is
  invisible on the public `map.html`/`profile.html` until someone on your
  team clicks **Approve** in `admin.html`. This prevents unverified or spam
  entries from reaching car owners.
- **Scaling**: Google Sheets comfortably handles a few thousand rows for
  this kind of use case. If the repairer network grows very large (tens of
  thousands of shops) or you need heavier concurrent traffic, you'd
  eventually want to migrate the backend to a proper database — but for
  launching and validating the idea, Sheets + Apps Script is a solid,
  zero-cost starting point.
