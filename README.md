# TravelVault
A free, local-first travel budget and savings tracker built with plain HTML, CSS and JavaScript. No npm, accounts, or paid services required.

## Run it
1. Download and unzip `TravelVault.zip`.
2. Open the `travelvault` folder in VS Code.
3. Open `index.html` in a browser, or use the VS Code **Live Server** extension and select **Open with Live Server**.
4. Click **New trip**, add your trip budget and dates, and then enter travel options and monthly savings.

## Features
- Many separate trips with Planning, Upcoming, and Completed statuses; a dedicated history view
- Per-option ticket prices in MVR, USD purchased at the bank, manual MVR-per-USD exchange rates, accommodation and other expenses
- Trip cost = ticket MVR + (USD purchased × MVR/USD rate) + stay MVR + other MVR
- Budget left after a travel option = trip budget − option total
- Any number of savers per trip; each saver has a separate monthly target and actual contributions, with live progress bars
- During trip creation, choose the first saving month and number of months (0–60), and TravelVault automatically creates the monthly target rows
- Destination search suggestions for real city names via the free Open-Meteo geocoding service (internet required for suggestions; manual entry still works)
- Edit/delete trips, travel options and savings entries
- Data persists in **this browser** using localStorage and survives page reloads/browser restarts (unless cleared)
- JSON backup export and import (import **replaces** local data after confirmation)
- Mobile-friendly responsive layout; all user-entered display text is HTML-escaped

## Example matching the spreadsheet
Create a trip with budget **34,000 MVR** and two savers W and H. For option FlyDubai, add ticket **8,018.40**, USD purchased **1,000**, rate **15.42**, stay **5,026.92**. Total = **28,465.32 MVR**, budget left = **5,534.68 MVR**. Add October savings W **7,000** and H **4,000**. Total saved = **11,000 MVR** and savings progress = **32.35%**.

## Updating from the earlier version
- Export a JSON backup from your previous version before replacing the files.
- Extract the ZIP and replace the old project files, then open using the same Live Server address/browser origin to access existing localStorage data.
- Existing two-person W/H savings are automatically interpreted in the new multi-saver table. You do not need to delete older trips.
- New trips automatically generate their monthly planned rows; editing an existing trip does not automatically overwrite past monthly rows. Add additional months as needed.

## Important limitations
- Browser storage is specific to the browser/device/origin. Clearing site data, using private mode, or changing browsers may lose data. **Export backups regularly.**
- This is a local-first version with **no cloud account or syncing**. Save your JSON backups somewhere safe.
- Real city suggestions require internet connectivity; the geocoding lookup can be unavailable, so manual destinations remain possible.
- Exchange rates are entered by you, not fetched from a bank or live market.
- Monetary calculations use normal JavaScript floating-point numbers and are rounded to two decimals for display; suitable for personal planning, not financial accounting.
- Trip history keeps *the latest state* of each completed trip, not a dated audit log of all edits.

## Project files
- `index.html` – interface shell
- `styles.css` – styling and responsive layouts
- `app.js` – application logic, calculations and persistence
