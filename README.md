# Workpath

Workpath is a mobile-first Vite app built with vanilla JavaScript and Supabase Auth. This task provides the app shell, profile onboarding, and placeholder dashboards.

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

Tracking features are not part of this task, so the dashboard currently shows mode-specific placeholders.

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
