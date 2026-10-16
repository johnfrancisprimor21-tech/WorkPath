# Workpath

Workpath is a mobile-first Vite app built with vanilla JavaScript and Supabase. It includes authentication, onboarding, and the first employed-mode tools for managing jobs and shifts.

## Architecture

Screens use the repository returned by `getRepo()` in `src/js/data/index.js`. Workpath supports account storage through Supabase and on-device storage through IndexedDB; the selected mode is saved in `localStorage` under `workpath.storageMode`. Local data stays on this device and is not merged with account data. Only `src/js/data/` may access Supabase tables or IndexedDB; the app's auth/session code uses Supabase Auth directly in account mode. Repositories own user scoping, validation, timestamp normalization, and friendly `DataError` messages, while pure summaries, worked-minute calculations, pay-period rules, pay estimates, and statistics live in `src/js/shared/`. Statistics functions take arrays and return plain data, so later export work can reuse their calculations. `src/js/shared/charts.js` builds accessible SVG charts from CSS theme tokens without a chart dependency. Payroll entries and statistics use the same repository data in account and local storage; local IndexedDB upgrades add the payroll store without replacing existing data. Memory and IndexedDB repositories run the shared contract tests. JSON import/export work can extend the same entity boundary without changing screen access patterns.

Account-mode Stats do not cache repository reads, so loading records requires a network connection. Local mode can load its IndexedDB data offline. If an account-mode read fails, the Stats page shows the repository's friendly network error and a “Try again” action without presenting empty charts or zero-valued summaries as loaded data.

JSON backup format version 1 includes user-entered records but omits account identity, database-managed fields, and derived values. Import only adds records; natural-key duplicates are skipped by default, and amounts are never converted when currencies differ. The Settings transfer UI uses `src/js/shared/files.js` for all file picking and saving, keeping browser file access behind one replaceable boundary. Account users can move data from an existing local database through the same preview and importer; the local copy remains unless the user explicitly deletes it. Transfer browser checks are separate from `npm test`: start Vite, set `WORKPATH_BROWSER_TEST_URL` to `/tests/browser/transfer.html`, and run `node tests/browser/run-payroll.cjs` with the external Playwright installation documented below.

## Run the app

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from your Supabase project. In PowerShell, use `Copy-Item .env.example .env.local`.
3. Start Vite:

   ```sh
   npm run dev
   ```

For local email confirmation, add the Vite URL (usually `http://localhost:5173`) to the Supabase Auth redirect URL allowlist. Restart the development server after changing `.env.local`. The app displays a setup message if either value is missing.

## Manual app checklist

Use a test email account in the Supabase project configured above.

1. Open the local app and sign up with a valid email and a password shorter than 8 characters. Confirm the app asks for a longer password. Then sign up with a valid password.
2. If Supabase requires email confirmation, confirm the app shows “Check your email”. Open the confirmation link. Return to the app and verify it routes to onboarding.
3. While signed in but not onboarded, visit `#/app`, `#/login`, and `#/signup` directly. Verify each route forces onboarding.
4. On onboarding, clear the currency and time zone and try to submit. Verify the form blocks submission. Choose a currency from the searchable list, select a pay frequency, keep or change the prefilled time zone, choose a mode, and save.
5. Verify onboarding opens the matching placeholder dashboard. Change the mode and confirm the heading and mode value update, then refresh to verify the selected mode remains.
6. Open Settings, change currency, pay frequency, and time zone, save, then refresh. Verify the saved choices remain.
7. Refresh while signed in and verify the app restores the session before showing the dashboard. Visit `#/login`, `#/signup`, and `#/onboarding`; each should redirect to `#/app`.
8. Log out. Verify the app returns to sign in. Visit `#/app` and `#/onboarding` while signed out; both should redirect to `#/login`.
9. Optionally switch the device appearance between light and dark, and use the form with a keyboard to check theme and focus styling.

## Employed routes

- `#/app` shows the dashboard and, in Employed mode, links to shift logging and jobs.
- `#/employed/shifts` lets you record duty days and days off, view monthly worked-time summaries, and edit or delete shifts.
- `#/employed/jobs` lets you add, edit, end, and delete employments.
- `#/employed/pay` tracks paydays and compares gross pay with estimates from logged hours and job rates.
- `#/employed/stats` summarizes hours, overtime, duty days, earnings, and per-job totals.

Employed routes redirect to the dashboard while Job Seeker mode is selected. The app reads shifts from the `shifts` table and computes worked minutes in JavaScript; the existing `shifts_with_hours` database view remains unchanged and unused. It converts local times using the profile time zone, rejects skipped spring-forward times, and uses the first occurrence of repeated fall-back times.

## Statistics

- `#/employed/stats` is available in Employed mode and offers 3, 6, or 12 calendar months of summaries. Stats is a compact fifth item in the Employed bottom navigation.
- `#/seeker/stats` is available in Job Seeker mode and shows application statuses, weekly and monthly trends, and response rate. Job Seeker navigation includes Stats.

Statistics are calculated client-side by pure functions in `src/js/shared/statistics.js`; accessible SVG charts are generated by `src/js/shared/charts.js`. Dates use UTC calendar arithmetic, estimates reuse the shared payroll helper, and chart labels are escaped before rendering. These plain results are reusable by later CSV/PDF export work. For the browser regression checks, start Vite with `npm run dev -- --host 127.0.0.1` and open `http://127.0.0.1:5173/tests/browser/statistics.html`. For headless Playwright, set `WORKPATH_BROWSER_TEST_URL` to that page and run `node tests/browser/run-payroll.cjs` with the external Playwright setup described under Payroll browser checks.

## Job seeker routes

- `#/app` shows the application summary and, in Job Seeker mode, a link to applications.
- `#/seeker/applications` lists and filters applications, supports status updates, and includes an editable timeline.

The Job Seeker route redirects to the dashboard while Employed mode is selected. Application status filters operate on the fetched latest 500 records; the page notes when it reaches that limit. Each status update is saved before its timeline event is inserted, so a timeline warning does not undo a successfully saved status.

## Verify the app

Run the automated tests and production build:

```sh
npm test
npm run build
```

Manual checklist (use an account set to Employed mode):

1. Add a job with employer, optional title/rate, and dates. Edit it, then mark it ended and confirm its end date defaults to today in the profile time zone. Delete a job and confirm the inline message explains linked shifts will remain without the employer.
2. Log a normal duty shift with a break and employer. Confirm it appears under the selected date with time, break, employer, and computed worked time. Edit it and save the change.
3. Log an overnight shift from 10:00 pm to 6:00 am with a 60 minute break. Confirm the next-day hint appears and it shows `7h 0m` worked.
4. Log an Off day and confirm time, break, and overtime controls are hidden. Also check Leave, Sick, and Holiday can be saved as non-duty days.
5. Use previous/next month controls and confirm each month loads its own grouped shifts and summary. Delete a shift using the inline confirmation.
6. Change to Job Seeker mode and confirm the employed links and employed routes are no longer available. Switch back and confirm jobs and shifts are still present. While in Job Seeker mode, open `#/employed/shifts` directly and confirm it redirects to `#/app`.
7. Try the shift form on a New York spring-forward date at 2:30 am and confirm it asks for another time. On the fall-back repeated 1:30 am time, confirm it resolves to the first occurrence.

Automated tests use Node's built-in test runner and fake-indexeddb to exercise the shared repository contract against memory and IndexedDB, including user isolation, timestamp normalization, storage cleanup, and the Supabase/IndexedDB access boundary. Other tests cover worked-minute calculations, HTTP(S)-only links, optional email validation, application counts, Asia/Manila, New York daylight-saving transitions, and overnight shifts.

### Payroll browser checks

The browser regression page is separate from `npm test`. Start Vite with `npm run dev -- --host 127.0.0.1`, then open `http://127.0.0.1:5173/tests/browser/payroll.html` in a browser. It runs each payroll check with both local IndexedDB and a network-free fake account repository.

For a headless Playwright run, keep Playwright and Chromium outside the project. In a second PowerShell terminal, run:

```powershell
$playwrightDir = Join-Path $env:TEMP 'workpath-playwright'
npm install --prefix $playwrightDir --no-save --no-package-lock playwright
& (Join-Path $playwrightDir 'node_modules/.bin/playwright.cmd') install chromium
$env:WORKPATH_PLAYWRIGHT_DIR = $playwrightDir
node tests/browser/run-payroll.cjs
```

The runner uses the installed Playwright directory and exits nonzero if the page reports failed checks.

For the Statistics browser regression page, keep the same dev server and Playwright installation, set `$env:WORKPATH_BROWSER_TEST_URL = 'http://127.0.0.1:5173/tests/browser/statistics.html'`, then run `node tests/browser/run-payroll.cjs`.

### Backup and transfer browser checks

Start Vite with `npm run dev -- --host 127.0.0.1`. In another PowerShell terminal, use the same external Playwright installation documented above:

```powershell
$env:WORKPATH_PLAYWRIGHT_DIR = Join-Path $env:TEMP 'workpath-playwright'
$env:WORKPATH_BROWSER_TEST_URL = 'http://127.0.0.1:5173/tests/browser/transfer.html'
node tests/browser/run-payroll.cjs
```

Manual checklist (use an account set to Job Seeker mode):

1. Add an application with company, position, date, and pending status. Add optional source, URL, location, contact, and notes. Confirm it appears newest first with a status badge and a safe external job link.
2. Edit the application and verify the changes persist after refresh. Try an invalid URL and contact email; confirm each is rejected with a clear message.
3. Click each status filter chip and verify the count and matching cards. Search by part of the company name and position, then try a search with no matches.
4. Change an application's status from its card. Expand its timeline and confirm a `status_changed` event appears with the old and new statuses. Add an event, edit it, and delete it. Confirm a status-change event can be deleted but has no edit control.
5. Delete an application with the inline confirmation and verify it explains that the timeline events will also be deleted.
6. Switch to Employed mode and back. Confirm applications remain. While Employed mode is selected, open `#/seeker/applications` directly and confirm it redirects to `#/app`.

Automated helper tests cover HTTP(S)-only URL validation, optional email validation, and per-status counts.

## End-to-end browser suite

The Playwright suite drives the actual Vite app in Chromium. Install the browser once with `npx playwright install chromium`, then run `npm run e2e`. `npm run e2e:local` runs only local-mode cases and requires no test-user credentials. `npm run e2e:headed` opens Chromium while running the full suite. The suite starts Vite on `127.0.0.1:5173` and reuses an existing server.

Account scenarios use a dedicated Supabase test account and are opt-in: set `E2E_ACCOUNT=1` and put `E2E_EMAIL` and `E2E_PASSWORD` in the ignored `.env.e2e.local` file. Otherwise account-mode tests skip and local-mode tests still run. Global setup signs in once and stores the session under ignored `playwright/.auth/`. Failure artifacts go under ignored `test-results/` and `playwright-report/`. Account traces are disabled so authorization headers cannot enter trace files.

Account-mode E2E is currently unreliable: a failed test restarts the worker and can lose the shared saved session, while injected-failure tests can trip the console-error guard. The planned redesign is for each account test to sign in through the real login form, with tests that inject failures explicitly allowing only their own expected console errors.

## Apply the database migration

In the Supabase SQL Editor, run the complete contents of `supabase/migrations/0001_init.sql`.

Or, after initializing this repository with `supabase init` (if it has not already been initialized) and linking it to the target project, run:

```sh
supabase link --project-ref <project-ref>
supabase db push
```

For a local Supabase database, start the local stack and apply migrations with `supabase start` followed by `supabase db reset`.

## Run the RLS check

Run the complete contents of `supabase/tests/rls_check.sql` in the Supabase SQL Editor using the privileged project connection. It creates two temporary auth users and test rows, checks cross-user access and the overnight shift calculation, then rolls everything back.

To run it with `psql`, use a privileged database connection URL:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_check.sql
```

The script requires permission to insert into `auth.users` and switch to the `authenticated` role. A successful run ends with `ROLLBACK`, leaving no test data behind.
