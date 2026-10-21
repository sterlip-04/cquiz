# GitHub → Vercel → OpenRouter

## Hosting configuration

Import the private `cquiz` GitHub repository into your Vercel account. Keep the Vite preset, repository root, `npm run build`, and `dist` output. Select Node.js 24. The committed `vercel.json` routes API requests to a single function and student/instructor URLs to the frontend. Enable Fluid compute. Deploy a preview and rehearse before promoting to production.

Connect a PostgreSQL database through Vercel Storage/Marketplace (for example Neon) or use an existing compatible PostgreSQL database. Choose a region close to the Vercel function. Use the provider's **pooled** connection string with TLS, and enable the provider's backup/recovery options appropriate for exam evidence. Selecting a provider plan or accepting its terms is an account-owner decision.

Set these private Vercel environment variables for the environment being tested:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Pooled PostgreSQL connection string. Never put it in a `VITE_` variable. |
| `ADMIN_PASSWORD` | A strong private instructor password, at least 12 characters. |
| `CQUIZ_ENCRYPTION_KEY` | Stable random 32-byte key, encoded as 64 hexadecimal characters. Keep it backed up privately. |
| `PUBLIC_ORIGIN` | Exact production HTTPS origin, with no trailing slash, once assigned. Preview and branch aliases supplied by Vercel are also accepted. |
| `OPENROUTER_API_KEY` | Optional here: alternatively enter it in the instructor workspace. |
| `OPENROUTER_MODEL` | Optional here: exact OpenRouter model ID supporting the grading schema. |
| `OPENROUTER_ZDR` | `true` by default; connection test confirms a compatible route exists. |

Do not change the encryption key after storing an OpenRouter key in the workspace. Changing it requires re-entering the provider key. Redeploy after changing environment variables. Use separate databases for preview rehearsals and production exams so preview tests cannot alter real exam evidence. Keep Vercel preview access protection enabled while testing; the eventual classroom URL must be accessible to student phones.

The server creates its tables on first successful connection. It stores accepted exam mutations and their audit events in one PostgreSQL transaction. Grading calls happen outside those locks. Durable leases let later requests recover interrupted evaluations. Hosted clients refresh every 2.5 seconds; the authoritative clock advances from saved deadlines whenever an authenticated exam request arrives. No always-running server, filesystem database or minute-based cron is required. When no browser is connected, phase advancement is materialized on the next request using elapsed time.

## Google sign-in (optional)

Google sign-in lets students and instructors use their school Google accounts instead of email + student ID or the shared password.

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create a project, configure the OAuth consent screen (Internal if your school's Google Workspace allows it), then create an **OAuth client ID** of type **Web application**.
2. Under **Authorized JavaScript origins**, add the exact classroom URL (for example `https://cquiz-silk.vercel.app`) and `http://localhost:4318` for local testing. No redirect URI is needed.
3. Add these private Vercel environment variables and redeploy:

| Variable | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | The client ID ending in `.apps.googleusercontent.com`. Turns Google sign-in on. |
| `ADMIN_EMAILS` | Comma-separated Google emails allowed into the instructor workspace. The password login keeps working. |
| `GOOGLE_ALLOWED_DOMAINS` | Optional. Only accept accounts from these Workspace domains, e.g. `g.clemson.edu`. |
| `GOOGLE_EMAIL_ALIASES` | Optional. Treat domains as the same mailbox, e.g. `g.clemson.edu=clemson.edu`, when the roster uses a different address form. |

With `GOOGLE_CLIENT_ID` set, **live** exams accept students only through Google, matching the verified Google email to the roster email. **Rehearsal** exams keep email + student ID so fictional students can still join. The server verifies Google's signature, audience, issuer, expiry and verified-email claim before trusting an address. Check that the roster's email addresses are the ones students sign in to Google with.

## OpenRouter setup

Open the instructor workspace, enter the key and model, and select **Test grading connection**. The probe uses synthetic evidence and the exact grading schema. Live exams cannot start until the current key/model/privacy configuration passes. Requests send the question, weighted rubric and answer text without school email or student ID. The key remains server-side, encrypted at rest. Provider failures produce an explicit failed grading job, never rehearsal scores. The instructor can retry after correcting the provider configuration; a started exam retains its original provider configuration fingerprint and requires that configuration for retries.

## Readiness rehearsal

Verify the deployed API, private instructor login, upload templates, four real phones, live transcription, one real OpenRouter evaluation, peer rating gates, a full mingle, pause/reconnect, and downloadable evidence. Keep the phones awake and confirm classroom Wi-Fi allows the site and browser speech service. Verify database backup/recovery before the actual exam. Record the tested phone/browser versions. A local test suite cannot establish these account and device conditions.

Sources: [Vercel Vite functions](https://vercel.com/docs/frameworks/frontend/vite), [Vercel Marketplace storage](https://vercel.com/docs/marketplace-storage), [Neon connection pooling](https://neon.com/docs/connect/connection-pooling), [Vercel function lifecycle](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package).
