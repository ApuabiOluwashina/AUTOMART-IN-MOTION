/**
 * AutoMart IM Roadside Repairer Network — Google Apps Script backend
 * ------------------------------------------------------------
 * This script turns a Google Sheet into the "database + server" for the
 * platform. It powers five pages:
 *   1. signup.html          — auto-repairers register (writes a new row)
 *   2. map.html              — car owners see approved repairers on a map (reads rows)
 *   3. admin.html            — AutoMart IM team approves/edits/rejects sign-ups (reads + writes)
 *   4. profile.html          — public profile for one repairer (photo, rating, price, "Pay & book")
 *   5. update-location.html  — a repairer's personal page to update their live location
 *
 * SETUP
 * -----
 * 1. Create a new Google Sheet. Rename the first tab exactly: Repairers
 * 2. In row 1, add these headers (columns A → S), exactly in this order:
 *      ID | Timestamp | ShopName | ContactName | Phone | Email | Address |
 *      Latitude | Longitude | Services | Status | LastUpdated | ImageURL |
 *      Rating | RatingCount | IsMobile | MobileServices | CalloutPrice | AvailableNow
 *    (ImageURL/Rating/RatingCount power the admin dashboard's card gallery —
 *    Rating is set by your team as an internal quality score for now, not
 *    yet fed by car-owner reviews. IsMobile/MobileServices/CalloutPrice/
 *    AvailableNow power the "mobile mechanic" and payment features below.)
 *
 *    *(Upgrading an existing Sheet? Just add the four new columns —
 *    IsMobile, MobileServices, CalloutPrice, AvailableNow — at the end.
 *    Existing rows are unaffected; they'll just read as blank/false until
 *    a repairer edits their listing.)*
 * 3. Extensions → Apps Script. Delete any starter code and paste this whole file.
 * 4. Set an admin key so only your team can approve/edit entries:
 *      Project Settings (gear icon) → Script Properties → Add property
 *      Name:  ADMIN_KEY
 *      Value: choose a long random password, e.g. automart-im-2026-XYZ
 *    Put that same value into admin.html (CONFIG.ADMIN_KEY prompt) when you log in.
 * 4b. (Optional, for the Paystack "Pay & book" button) Also add a script
 *    property named PAYSTACK_SECRET_KEY with your Paystack **secret** key
 *    (starts with sk_). This lets the server verify a payment really went
 *    through before it's recorded — see README.md, "Payments (Paystack)".
 * 5. Deploy → New deployment → type: "Web app"
 *      Execute as:      Me
 *      Who has access:  Anyone
 *    Click Deploy, then **authorize the permissions** — this version also
 *    asks for Google Drive access, because it saves repairer-uploaded
 *    logo/photo files to a Drive folder. Copy the Web App URL.
 * 6. Paste that Web App URL into the CONFIG.API_URL constant at the top of
 *    every HTML page (signup.html, map.html, admin.html, profile.html,
 *    update-location.html).
 * 7. Every time you edit this script, you must create a NEW deployment
 *    version (Deploy → Manage deployments → Edit → New version) for the
 *    changes to go live at the same URL.
 *
 * Because Apps Script reads the sheet live on every request, you (or anyone
 * with edit access to the Sheet) can also add/edit/delete rows directly in
 * Google Sheets and the app will immediately reflect it — this is the
 * "editable both ways" behavior that was asked for.
 */

var SHEET_NAME = 'Repairers';
var BOOKINGS_SHEET_NAME = 'Bookings';
var REVIEWS_SHEET_NAME = 'Reviews';
var HEADERS = ['ID', 'Timestamp', 'ShopName', 'ContactName', 'Phone', 'Email',
               'Address', 'Latitude', 'Longitude', 'Services', 'Status', 'LastUpdated',
               'ImageURL', 'Rating', 'RatingCount', 'IsMobile', 'MobileServices',
               'CalloutPrice', 'AvailableNow'];
var BOOKINGS_HEADERS = ['Reference', 'RepairerID', 'ShopName', 'PayerName', 'PayerPhone',
                         'Amount', 'Status', 'Timestamp'];
var REVIEWS_HEADERS = ['ID', 'RepairerID', 'CarOwnerName', 'Stars', 'ReviewText',
                        'HelpfulCount', 'Timestamp'];

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function doGet(e) {
  try {
    var action = (e.parameter.action || 'list');
    var sheet = getSheet_();

    if (action === 'health') {
      return jsonOut_({ ok: true, message: 'AutoMart IM Repairer Network API is running.' });
    }

    if (action === 'list') {
      // Public: only approved repairers, for the car-owner map.
      var rows = getAllRows_(sheet).filter(function (r) { return r.Status === 'Approved'; });
      return jsonOut_({ ok: true, repairers: rows.map(stripInternal_) });
    }

    if (action === 'admin_list') {
      // Protected: every row, any status, for the AutoMart IM admin dashboard.
      if (!checkAdminKey_(e.parameter.adminKey)) return jsonOut_({ ok: false, error: 'Invalid admin key.' });
      var allRows = getAllRows_(sheet);
      return jsonOut_({ ok: true, repairers: allRows });
    }

    if (action === 'get_repairer') {
      // Public: a single approved repairer's public profile (profile.html).
      if (!e.parameter.id) return jsonOut_({ ok: false, error: 'id is required.' });
      var found = getAllRows_(sheet).filter(function (r) {
        return r.ID === e.parameter.id && r.Status === 'Approved';
      })[0];
      if (!found) return jsonOut_({ ok: false, error: 'Repairer not found or not yet approved.' });
      return jsonOut_({ ok: true, repairer: stripInternal_(found) });
    }

    if (action === 'self_lookup') {
      // A repairer looking up their own full record (update-location.html).
      // Their ID (a long random UUID, emailed/shown to them once at sign-up)
      // acts as a lightweight access token — see README.md, "Security notes".
      if (!e.parameter.id) return jsonOut_({ ok: false, error: 'id is required.' });
      var mine = getAllRows_(sheet).filter(function (r) { return r.ID === e.parameter.id; })[0];
      if (!mine) return jsonOut_({ ok: false, error: 'No repairer found with that link. Double-check the link or contact AutoMart IM.' });
      return jsonOut_({ ok: true, repairer: mine });
    }

    if (action === 'find_my_link') {
      // Lets a repairer who lost their personal link recover it by phone.
      if (!e.parameter.phone) return jsonOut_({ ok: false, error: 'phone is required.' });
      var normalizedQuery = String(e.parameter.phone).replace(/\D/g, '');
      var matches = getAllRows_(sheet).filter(function (r) {
        return String(r.Phone).replace(/\D/g, '') === normalizedQuery && normalizedQuery !== '';
      }).map(function (r) { return { ID: r.ID, ShopName: r.ShopName, Phone: r.Phone }; });
      return jsonOut_({ ok: true, matches: matches });
    }

    if (action === 'admin_bookings') {
      // Protected: every payment/booking record, for the admin dashboard.
      if (!checkAdminKey_(e.parameter.adminKey)) return jsonOut_({ ok: false, error: 'Invalid admin key.' });
      return jsonOut_({ ok: true, bookings: getAllBookings_() });
    }

    if (action === 'get_reviews') {
      // Public: every review for one repairer, newest first, plus a star
      // breakdown for the profile page's ratings chart. No admin key — the
      // adminKey param (if present) just also unlocks each review's ID so
      // admin.html can offer a delete/moderate button.
      if (!e.parameter.id) return jsonOut_({ ok: false, error: 'id is required.' });
      var reviews = getReviewsForRepairer_(e.parameter.id);
      var breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      reviews.forEach(function (rv) { if (breakdown[rv.Stars] !== undefined) breakdown[rv.Stars]++; });
      var total = reviews.length;
      var average = total ? reviews.reduce(function (sum, rv) { return sum + rv.Stars; }, 0) / total : 0;
      return jsonOut_({ ok: true, reviews: reviews, breakdown: breakdown, total: total, average: average });
    }

    return jsonOut_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var data = body.data || {};
    var sheet = getSheet_();

    if (action === 'signup') {
      return jsonOut_(handleSignup_(sheet, data));
    }

    if (action === 'update_status') {
      if (!checkAdminKey_(body.adminKey)) return jsonOut_({ ok: false, error: 'Invalid admin key.' });
      return jsonOut_(handleUpdateStatus_(sheet, data));
    }

    if (action === 'edit') {
      if (!checkAdminKey_(body.adminKey)) return jsonOut_({ ok: false, error: 'Invalid admin key.' });
      return jsonOut_(handleEdit_(sheet, data));
    }

    if (action === 'delete') {
      if (!checkAdminKey_(body.adminKey)) return jsonOut_({ ok: false, error: 'Invalid admin key.' });
      return jsonOut_(handleDelete_(sheet, data));
    }

    if (action === 'update_location') {
      // No admin key — the repairer's own unguessable ID is their access
      // token here, from their personal update-location.html?id=... link.
      return jsonOut_(handleUpdateLocation_(sheet, data));
    }

    if (action === 'verify_payment') {
      return jsonOut_(handleVerifyPayment_(sheet, data));
    }

    if (action === 'submit_review') {
      // No admin key — any car owner can leave a rating + review.
      return jsonOut_(handleSubmitReview_(sheet, data));
    }

    if (action === 'mark_helpful') {
      return jsonOut_(handleMarkHelpful_(data));
    }

    if (action === 'delete_review') {
      if (!checkAdminKey_(body.adminKey)) return jsonOut_({ ok: false, error: 'Invalid admin key.' });
      return jsonOut_(handleDeleteReview_(sheet, data));
    }

    return jsonOut_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

function handleSignup_(sheet, data) {
  var required = ['shopName', 'contactName', 'phone', 'address', 'latitude', 'longitude'];
  for (var i = 0; i < required.length; i++) {
    if (data[required[i]] === undefined || data[required[i]] === '') {
      return { ok: false, error: 'Missing required field: ' + required[i] };
    }
  }

  var id = Utilities.getUuid();
  var now = new Date();
  var services = Array.isArray(data.services) ? data.services.join(', ') : (data.services || '');
  var mobileServices = Array.isArray(data.mobileServices) ? data.mobileServices.join(', ') : (data.mobileServices || '');
  var isMobile = data.isMobile === true || data.isMobile === 'true';
  var calloutPrice = (data.calloutPrice !== undefined && data.calloutPrice !== '') ? Number(data.calloutPrice) : '';

  // A logo/photo uploaded straight from the repairer's device takes
  // priority over a pasted link, if both were somehow sent.
  var imageUrl = data.imageBase64
    ? saveImageAndGetUrl_(data.imageBase64, data.imageMimeType, data.imageFileName, data.shopName)
    : (data.imageUrl || '');

  sheet.appendRow([
    id,
    now,
    data.shopName,
    data.contactName,
    data.phone,
    data.email || '',
    data.address,
    Number(data.latitude),
    Number(data.longitude),
    services,
    'Pending',   // every new sign-up starts pending until AutoMart IM approves it
    now,
    imageUrl,
    0,           // Rating — set later by AutoMart IM in the admin dashboard
    0,           // RatingCount
    isMobile,
    mobileServices,
    calloutPrice,
    true         // AvailableNow — defaults to available; the repairer can toggle it later
  ]);

  return { ok: true, id: id, message: 'Sign-up received. It will appear on the public map once approved by AutoMart IM.' };
}

function handleUpdateStatus_(sheet, data) {
  if (!data.id || !data.status) return { ok: false, error: 'id and status are required.' };
  var allowed = ['Pending', 'Approved', 'Rejected'];
  if (allowed.indexOf(data.status) === -1) return { ok: false, error: 'status must be one of ' + allowed.join(', ') };

  var rowIndex = findRowIndexById_(sheet, data.id);
  if (rowIndex === -1) return { ok: false, error: 'No repairer found with that ID.' };

  var statusCol = HEADERS.indexOf('Status') + 1;
  var lastUpdatedCol = HEADERS.indexOf('LastUpdated') + 1;
  sheet.getRange(rowIndex, statusCol).setValue(data.status);
  sheet.getRange(rowIndex, lastUpdatedCol).setValue(new Date());

  return { ok: true, message: 'Status updated to ' + data.status };
}

function handleEdit_(sheet, data) {
  if (!data.id) return { ok: false, error: 'id is required.' };
  var rowIndex = findRowIndexById_(sheet, data.id);
  if (rowIndex === -1) return { ok: false, error: 'No repairer found with that ID.' };

  // A newly uploaded photo/logo file overrides any pasted image URL.
  if (data.imageBase64) {
    data.imageUrl = saveImageAndGetUrl_(data.imageBase64, data.imageMimeType, data.imageFileName, data.shopName || data.id);
  }

  var fieldMap = {
    shopName: 'ShopName', contactName: 'ContactName', phone: 'Phone', email: 'Email',
    address: 'Address', latitude: 'Latitude', longitude: 'Longitude', services: 'Services',
    imageUrl: 'ImageURL', rating: 'Rating', ratingCount: 'RatingCount',
    isMobile: 'IsMobile', mobileServices: 'MobileServices', calloutPrice: 'CalloutPrice',
    availableNow: 'AvailableNow'
  };
  var numericKeys = ['latitude', 'longitude', 'rating', 'ratingCount', 'calloutPrice'];
  var listKeys = ['services', 'mobileServices'];
  var boolKeys = ['isMobile', 'availableNow'];

  Object.keys(fieldMap).forEach(function (key) {
    if (data[key] !== undefined) {
      var col = HEADERS.indexOf(fieldMap[key]) + 1;
      var value = data[key];
      if (numericKeys.indexOf(key) !== -1 && value !== '') value = Number(value);
      if (listKeys.indexOf(key) !== -1 && Array.isArray(value)) value = value.join(', ');
      if (boolKeys.indexOf(key) !== -1) value = (value === true || value === 'true');
      sheet.getRange(rowIndex, col).setValue(value);
    }
  });

  var lastUpdatedCol = HEADERS.indexOf('LastUpdated') + 1;
  sheet.getRange(rowIndex, lastUpdatedCol).setValue(new Date());

  return { ok: true, message: 'Repairer updated.' };
}

function handleDelete_(sheet, data) {
  if (!data.id) return { ok: false, error: 'id is required.' };
  var rowIndex = findRowIndexById_(sheet, data.id);
  if (rowIndex === -1) return { ok: false, error: 'No repairer found with that ID.' };
  sheet.deleteRow(rowIndex);
  return { ok: true, message: 'Repairer deleted.' };
}

/**
 * A repairer updates their own live position (and optionally their
 * "available now" flag) from update-location.html, using their personal
 * link — no admin key involved. See README.md, "Security notes".
 */
function handleUpdateLocation_(sheet, data) {
  if (!data.id) return { ok: false, error: 'id is required.' };
  if (data.latitude === undefined || data.longitude === undefined) {
    return { ok: false, error: 'latitude and longitude are required.' };
  }
  var rowIndex = findRowIndexById_(sheet, data.id);
  if (rowIndex === -1) return { ok: false, error: 'No repairer found with that link.' };

  sheet.getRange(rowIndex, HEADERS.indexOf('Latitude') + 1).setValue(Number(data.latitude));
  sheet.getRange(rowIndex, HEADERS.indexOf('Longitude') + 1).setValue(Number(data.longitude));
  if (data.availableNow !== undefined) {
    sheet.getRange(rowIndex, HEADERS.indexOf('AvailableNow') + 1).setValue(data.availableNow === true || data.availableNow === 'true');
  }
  sheet.getRange(rowIndex, HEADERS.indexOf('LastUpdated') + 1).setValue(new Date());

  return { ok: true, message: 'Location updated.' };
}

/**
 * Verifies a Paystack transaction server-side (never trust a client's
 * word that a payment succeeded) and logs it to the Bookings sheet.
 * Requires a PAYSTACK_SECRET_KEY script property — see setup step 4b.
 */
function handleVerifyPayment_(sheet, data) {
  if (!data.reference) return { ok: false, error: 'reference is required.' };
  if (!data.repairerId) return { ok: false, error: 'repairerId is required.' };

  var secretKey = PropertiesService.getScriptProperties().getProperty('PAYSTACK_SECRET_KEY');
  if (!secretKey) {
    return { ok: false, error: 'Payments are not configured yet. Ask AutoMart IM to add a PAYSTACK_SECRET_KEY script property.' };
  }

  var rowIndex = findRowIndexById_(sheet, data.repairerId);
  if (rowIndex === -1) return { ok: false, error: 'No repairer found with that ID.' };
  var repairerRow = getAllRows_(sheet).filter(function (r) { return r.ID === data.repairerId; })[0];

  var response = UrlFetchApp.fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(data.reference), {
    method: 'get',
    headers: { Authorization: 'Bearer ' + secretKey },
    muteHttpExceptions: true
  });
  var result = JSON.parse(response.getContentText());

  if (!result.status || !result.data || result.data.status !== 'success') {
    return { ok: false, error: 'Payment could not be verified. It may have failed or is still pending.' };
  }

  var bookings = getOrCreateBookingsSheet_();
  bookings.appendRow([
    data.reference,
    data.repairerId,
    repairerRow ? repairerRow.ShopName : '',
    data.payerName || '',
    data.payerPhone || '',
    result.data.amount / 100, // Paystack amounts are in kobo
    'Paid',
    new Date()
  ]);

  return { ok: true, message: 'Payment verified. ' + (repairerRow ? repairerRow.ShopName : 'The repairer') + ' has been booked.' };
}

/**
 * A car owner leaves a star rating + optional written review for a
 * repairer. Anyone with the profile link can submit one (no admin key,
 * no login) — this mirrors the low-friction sign-up/payment flows
 * elsewhere in the app. Once saved, the repairer's Rating/RatingCount on
 * the Repairers sheet are recomputed as the live average of all their
 * reviews, replacing whatever an admin may have set manually.
 */
function handleSubmitReview_(sheet, data) {
  if (!data.repairerId) return { ok: false, error: 'repairerId is required.' };
  var stars = Number(data.stars);
  if (!stars || stars < 1 || stars > 5) return { ok: false, error: 'stars must be a number from 1 to 5.' };

  var rowIndex = findRowIndexById_(sheet, data.repairerId);
  if (rowIndex === -1) return { ok: false, error: 'No repairer found with that ID.' };

  var reviews = getOrCreateReviewsSheet_();
  var id = Utilities.getUuid();
  reviews.appendRow([
    id,
    data.repairerId,
    (data.carOwnerName || '').toString().trim() || 'Anonymous driver',
    stars,
    (data.reviewText || '').toString().trim(),
    0, // HelpfulCount
    new Date()
  ]);

  recomputeRating_(sheet, rowIndex, data.repairerId);

  return { ok: true, message: 'Thanks for your review!' };
}

function handleMarkHelpful_(data) {
  if (!data.reviewId) return { ok: false, error: 'reviewId is required.' };
  var reviews = getOrCreateReviewsSheet_();
  var rowIndex = findReviewRowIndexById_(reviews, data.reviewId);
  if (rowIndex === -1) return { ok: false, error: 'Review not found.' };
  var col = REVIEWS_HEADERS.indexOf('HelpfulCount') + 1;
  var current = Number(reviews.getRange(rowIndex, col).getValue()) || 0;
  reviews.getRange(rowIndex, col).setValue(current + 1);
  return { ok: true, helpfulCount: current + 1 };
}

function handleDeleteReview_(sheet, data) {
  if (!data.reviewId) return { ok: false, error: 'reviewId is required.' };
  var reviews = getOrCreateReviewsSheet_();
  var rowIndex = findReviewRowIndexById_(reviews, data.reviewId);
  if (rowIndex === -1) return { ok: false, error: 'Review not found.' };
  var repairerId = reviews.getRange(rowIndex, REVIEWS_HEADERS.indexOf('RepairerID') + 1).getValue();
  reviews.deleteRow(rowIndex);

  var repairerRowIndex = findRowIndexById_(sheet, repairerId);
  if (repairerRowIndex !== -1) recomputeRating_(sheet, repairerRowIndex, repairerId);

  return { ok: true, message: 'Review deleted.' };
}

/**
 * Recalculates a repairer's Rating (average) and RatingCount (number of
 * reviews) from the Reviews sheet, and writes them back to the Repairers
 * row. Called after any review is added or removed.
 */
function recomputeRating_(sheet, repairerRowIndex, repairerId) {
  var reviews = getReviewsForRepairer_(repairerId);
  var count = reviews.length;
  var average = count ? reviews.reduce(function (sum, rv) { return sum + rv.Stars; }, 0) / count : 0;
  sheet.getRange(repairerRowIndex, HEADERS.indexOf('Rating') + 1).setValue(Math.round(average * 10) / 10);
  sheet.getRange(repairerRowIndex, HEADERS.indexOf('RatingCount') + 1).setValue(count);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet tab "' + SHEET_NAME + '" not found. Create it and add the header row.');
  return sheet;
}

function getAllRows_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var lastCol = HEADERS.length;
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return values
    .filter(function (row) { return row[0] !== ''; }) // skip blank rows
    .map(function (row) {
      var obj = {};
      HEADERS.forEach(function (h, i) { obj[h] = row[i]; });
      obj.Latitude = Number(obj.Latitude);
      obj.Longitude = Number(obj.Longitude);
      obj.Rating = Number(obj.Rating) || 0;
      obj.RatingCount = Number(obj.RatingCount) || 0;
      obj.IsMobile = (obj.IsMobile === true || obj.IsMobile === 'true' || obj.IsMobile === 'TRUE');
      obj.CalloutPrice = (obj.CalloutPrice === '' || obj.CalloutPrice === undefined) ? '' : Number(obj.CalloutPrice);
      // AvailableNow defaults to true for older rows that predate this column.
      obj.AvailableNow = !(obj.AvailableNow === false || obj.AvailableNow === 'false' || obj.AvailableNow === 'FALSE');
      if (obj.Timestamp instanceof Date) obj.Timestamp = obj.Timestamp.toISOString();
      if (obj.LastUpdated instanceof Date) obj.LastUpdated = obj.LastUpdated.toISOString();
      return obj;
    });
}

function stripInternal_(row) {
  // Public map/profile views don't need to expose email address, just what
  // a car owner needs to find, judge, and contact/book the shop.
  return {
    ID: row.ID,
    ShopName: row.ShopName,
    Phone: row.Phone,
    Address: row.Address,
    Latitude: row.Latitude,
    Longitude: row.Longitude,
    Services: row.Services,
    ImageURL: row.ImageURL,
    Rating: row.Rating,
    RatingCount: row.RatingCount,
    IsMobile: row.IsMobile,
    MobileServices: row.MobileServices,
    CalloutPrice: row.CalloutPrice,
    AvailableNow: row.AvailableNow,
    LastUpdated: row.LastUpdated
  };
}

function findRowIndexById_(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var idCol = HEADERS.indexOf('ID') + 1;
  var ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2; // +2 because data starts at row 2
  }
  return -1;
}

function getOrCreateBookingsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BOOKINGS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(BOOKINGS_SHEET_NAME);
    sheet.appendRow(BOOKINGS_HEADERS);
  }
  return sheet;
}

function getAllBookings_() {
  var sheet = getOrCreateBookingsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, BOOKINGS_HEADERS.length).getValues();
  return values
    .filter(function (row) { return row[0] !== ''; })
    .map(function (row) {
      var obj = {};
      BOOKINGS_HEADERS.forEach(function (h, i) { obj[h] = row[i]; });
      if (obj.Timestamp instanceof Date) obj.Timestamp = obj.Timestamp.toISOString();
      return obj;
    })
    .reverse(); // newest first
}

function getOrCreateReviewsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(REVIEWS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(REVIEWS_SHEET_NAME);
    sheet.appendRow(REVIEWS_HEADERS);
  }
  return sheet;
}

function getReviewsForRepairer_(repairerId) {
  var sheet = getOrCreateReviewsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, REVIEWS_HEADERS.length).getValues();
  return values
    .filter(function (row) { return row[0] !== '' && row[REVIEWS_HEADERS.indexOf('RepairerID')] === repairerId; })
    .map(function (row) {
      var obj = {};
      REVIEWS_HEADERS.forEach(function (h, i) { obj[h] = row[i]; });
      obj.Stars = Number(obj.Stars) || 0;
      obj.HelpfulCount = Number(obj.HelpfulCount) || 0;
      if (obj.Timestamp instanceof Date) obj.Timestamp = obj.Timestamp.toISOString();
      return obj;
    })
    .sort(function (a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); }); // newest first
}

function findReviewRowIndexById_(reviewsSheet, id) {
  var lastRow = reviewsSheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = reviewsSheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2;
  }
  return -1;
}

function getOrCreatePhotosFolder_() {
  var folderName = 'AutoMart IM Repairer Photos';
  var folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(folderName);
}

/**
 * Decodes a base64 image uploaded from a repairer's or admin's device,
 * saves it to a dedicated Drive folder, makes it viewable by link, and
 * returns a URL that renders directly in an <img> tag.
 */
function saveImageAndGetUrl_(base64, mimeType, fileName, labelForName) {
  if (!base64) return '';
  var bytes = Utilities.base64Decode(base64);
  var safeName = (fileName || (String(labelForName || 'repairer') + '-photo')).replace(/[^\w.\- ]/g, '_');
  var blob = Utilities.newBlob(bytes, mimeType || 'image/jpeg', safeName);
  var folder = getOrCreatePhotosFolder_();
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800';
}

function checkAdminKey_(key) {
  var stored = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  return stored && key && stored === key;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
