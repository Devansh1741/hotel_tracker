# Stayboard

A lightweight, mobile-friendly personal hotel-room tracker with a dashboard, three hotel views, room numbers, guest-group stays, and document attachments.

## Open the app

Open `index.html` in a modern desktop browser to preview the app. No package installation is required. The layout is responsive for iOS and Android phones, but accessing it from a phone requires deploying it to a private HTTPS web app; opening the local file only works on the computer that contains it.

The hotels are **Krati Resort**, **Jass Grand**, and **Maantra**. Use **Bulk add rooms** in the navigation to paste room numbers (one per line or comma-separated); existing numbers are skipped. You can also add a room individually.

The overview has **All rooms** and **Today** views, plus guest search. A guest group can have an ordered itinerary with different rooms or hotels for each date range. Add another itinerary segment whenever the group changes rooms or hotels; the app checks room conflicts and date order.

The current starter inventory is date-effective for the counts provided: Maantra has 20 rooms from Nov 19, 2026; Jass Grand has 6 from Nov 19 and 14 from Nov 20; Krati Resort has 10 from Nov 20. The room numbers are generated from 101 upward. These are app setup defaults, not connected to a live shared inventory.

For guest documents, upload the file to Google Drive separately and paste its Drive/Docs link into the stay. The app checks that the link uses HTTPS and a Google Drive/Docs domain, but it does not change the file's sharing permissions. Keep Aadhaar and other sensitive files restricted to the intended people.

## Google Sheets and Apps Script shared app

The app is prepared to run inside Apps Script so it can use the authenticated `google.script.run` bridge instead of making cross-origin web requests. The Apps Script files are in [`apps-script/`](./apps-script/).

1. In your standalone Apps Script project, replace `Code.gs` with [`apps-script/Code.gs`](./apps-script/Code.gs).
2. Create three HTML files in the Apps Script editor named **Index**, **Styles**, and **Client**. Paste the corresponding local files [`apps-script/Index.html`](./apps-script/Index.html), [`apps-script/Styles.html`](./apps-script/Styles.html), and [`apps-script/Client.html`](./apps-script/Client.html) into them.
3. Save, run `initializeStayboard` once, and approve the permissions. It creates the `Hotels`, `Rooms`, and `Stays` tabs and seeds the 44 date-effective rooms. It stops without seeding if those tabs already contain data.
4. Choose **Deploy → Manage deployments → Edit** on the existing web-app deployment, select **New version**, and deploy. Keep **Execute as: User accessing the web app**, and allow only the intended signed-in Google users. Grant each user Editor access to the Sheet; each user must sign in and authorize access.
5. Open the deployed web-app URL (ending in `/exec`). This is the shared app; users should open this URL rather than the local `index.html` preview.

The app reads and saves shared data through Apps Script. Revision checking prevents an older open page from overwriting newer changes; if that happens, reload the page before trying again. Google Drive files remain in Drive and are not copied into the Sheet. Restrict access to sensitive document links.

The standalone local `index.html` preview continues to use browser local storage and does not sync with the deployed app.

## Current storage and privacy

This starter version keeps booking details and Google Drive links in the browser's local storage. Multiple people and devices do not share data yet. The app does not upload documents: upload the document to Google Drive yourself, then paste its HTTPS Drive or Docs link into the stay. Links are not synced across browsers or devices and may be lost if browser site data is cleared. The Drive file's own sharing permissions still control who can open it. For sensitive identity documents, keep sharing restricted to the intended account(s).

The room status **Extra** is a manual label for a special or additional room. Existing attachments saved by an older version remain downloadable from stay details.

## Information needed to finish setup

- What you mean by **Extra** if it should mean something other than a manually tagged room.
- Whether anyone else needs access to the app.
- Deploy the Apps Script backend and connect/host the frontend before using shared live bookings.
