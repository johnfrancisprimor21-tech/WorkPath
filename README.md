# Workpath

Workpath is a mobile-first Vite app built with vanilla JavaScript and Supabase. It includes authentication, onboarding, and the first employed-mode tools for managing jobs and shifts.

## Architecture

Screens use the repository returned by `getRepo()` in `src/js/data/index.js`. Workpath supports account storage through Supabase and on-device storage through IndexedDB; the selected mode is saved in `localStorage` under `workpath.storageMode`. Local data stays on this device and is not merged with account data. Only `src/js/data/` may access Supabase tables or IndexedDB; the app's auth/session code uses Supabase Auth directly in account mode. Repositories own user scoping, validation, timestamp normalization, and friendly `DataError` messages, while pure summaries, worked-minute calculations, pay-period rules, and pay estimates live in `src/js/shared/`. Payroll entries are available through the same repository contract in account and local storage; local IndexedDB upgrades add the payroll store without replacing existing data. Memory and IndexedDB repositories run the shared contract tests. JSON import/export work can extend the same entity boundary without changing screen access patterns.

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

Employed routes redirect to the dashboard while Job Seeker mode is selected. The app reads shifts from the `shifts` table and computes worked minutes in JavaScript; the existing `shifts_with_hours` database view remains unchanged and unused. It converts local times using the profile time zone, rejects skipped spring-forward times, and uses the first occurrence of repeated fall-back times.

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

Manual checklist (use an account set to Job Seeker mode):

1. Add an application with company, position, date, and pending status. Add optional source, URL, location, contact, and notes. Confirm it appears newest first with a status badge and a safe external job link.
2. Edit the application and verify the changes persist after refresh. Try an invalid URL and contact email; confirm each is rejected with a clear message.
3. Click each status filter chip and verify the count and matching cards. Search by part of the company name and position, then try a search with no matches.
4. Change an application's status from its card. Expand its timeline and confirm a `status_changed` event appears with the old and new statuses. Add an event, edit it, and delete it. Confirm a status-change event can be deleted but has no edit control.
5. Delete an application with the inline confirmation and verify it explains that the timeline events will also be deleted.
6. Switch to Employed mode and back. Confirm applications remain. While Employed mode is selected, open `#/seeker/applications` directly and confirm it redirects to `#/app`.

Automated helper tests cover HTTP(S)-only URL validation, optional email validation, and per-status counts.

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
