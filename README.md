# Stayboard

A lightweight, mobile-friendly personal hotel-room tracker with a dashboard, three hotel views, room numbers, guest-group stays, and document attachments.

## Open the app

Open `index.html` in a modern desktop browser to preview the app. No package installation is required. The layout is responsive for iOS and Android phones, but accessing it from a phone requires deploying it to a private HTTPS web app; opening the local file only works on the computer that contains it.

The hotels are **Krati Resort**, **Jass Grand**, and **Maantra**. Use **Bulk add rooms** in the navigation to paste room numbers (one per line or comma-separated); existing numbers are skipped. You can also add a room individually.

The overview has **All rooms** and **Today** views, plus guest search. A guest group can have an ordered itinerary with different rooms or hotels for each date range. Add another itinerary segment whenever the group changes rooms or hotels; the app checks room conflicts and date order.

The dashboard statistics show totals across all hotels in Overview and only the selected hotel's counts in a hotel view. Date fields use the browser's native date picker.

The starter inventory has three rooms (1, 2, and 3) at each hotel, available immediately.

For guest documents, upload the file to Google Drive separately and paste its Drive/Docs link into the stay. The app checks that the link uses HTTPS and a Google Drive/Docs domain, but it does not change the file's sharing permissions. Keep Aadhaar and other sensitive files restricted to the intended people.

## Vercel website and Google Sheets sync

The website is hosted on Vercel. Apps Script is used only as a private Sheets backend; its `/exec` URL is not the website. The Vercel API verifies Google sign-in and checks an email allowlist before forwarding requests. The Apps Script API key belongs only in server-side settings, never in `app.js`, `config.js`, or other public files.

### Configure the Apps Script backend

1. In the Apps Script project connected to the spreadsheet, replace `Code.gs` with [`apps-script/Code.gs`](./apps-script/Code.gs).
2. In **Project Settings → Script properties**, add `STAYBOARD_API_KEY` with a long, unique secret. You will enter the same value as a Vercel environment variable; do not put it in this repository.
3. If the Sheet is new and empty, run `initializeStayboard` once. If it is already initialized, keep its existing data. The updated script appends `firstCheckInAt` and `firstCheckOutAt` to `Stays` when needed and backfills those columns from existing first itinerary segments. They contain actual date-time cells.
4. Choose **Deploy → Manage deployments → Edit**, select **New version**, and deploy as a web app that **executes as you** and is accessible to **Anyone**. Vercel sends requests only after Google sign-in and allowlist checks, and Apps Script rejects requests without the server-side API key. The `/exec` URL responds with an API status message, not a website.

### Configure Google sign-in and Vercel

1. In Google Cloud Console, create a **Web application** OAuth client ID. Add the exact website origins (for example, `https://hotel.shiv-may-sangam.site` and your Vercel project's production `https://<project>.vercel.app` URL) to **Authorized JavaScript origins**.
2. Add the client ID to [`config.js`](./config.js). Set the same ID as Vercel's `GOOGLE_CLIENT_ID` environment variable.
3. Set these Vercel environment variables:
   - `GOOGLE_CLIENT_ID`: the Web OAuth client ID.
   - `ALLOWED_EMAILS`: set to `*` to allow any Google account with a verified email, or use comma-separated email addresses to restrict access.
   - `APPS_SCRIPT_URL`: the deployed Apps Script `/exec` URL.
   - `STAYBOARD_API_KEY`: the same secret stored in Apps Script Script properties.
4. Deploy the site to Vercel and add the desired custom domain there. Vercel installs the server dependency in [`package.json`](./package.json) for the `/api/data` function.

Setting `ALLOWED_EMAILS` to `*` means any verified Google account can read and modify all shared hotel and guest data, including saved Drive document links. This is not a public anonymous endpoint, but it does not restrict which Google accounts may use it; for guest privacy, an explicit email allowlist is safer. Authorized users sign in on the website; they do not need direct Sheet Editor access because Apps Script writes as the spreadsheet owner. Grant them access to any Drive documents separately. The app uses revision checking to prevent an older page from overwriting newer shared data; reload if another user has saved first. Local `index.html` preview remains browser-local and does not sync.

## Storage and privacy

The Apps Script backend reads and writes booking details and Google Drive links in the shared Google Sheet. The Vercel API checks Google sign-in and either the configured allowlist or the `*` all-Google-accounts setting before forwarding requests. The standalone local preview keeps data in that browser's local storage and does not sync. The app does not upload documents: upload each file to Google Drive yourself, then paste its HTTPS Drive or Docs link into the stay. The Drive file's own sharing permissions control who can open it. For sensitive identity documents, keep sharing restricted to the intended accounts.

The room status **Extra** is a manual label for a special or additional room. Existing attachments saved by an older version remain downloadable from stay details.

## Information needed to finish setup

- What you mean by **Extra** if it should mean something other than a manually tagged room.
- The Google OAuth Web client ID and the Google accounts to put in Vercel's `ALLOWED_EMAILS`.
- Set the four Vercel environment variables and deploy the Apps Script backend before using shared live bookings.
