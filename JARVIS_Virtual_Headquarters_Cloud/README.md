# JARVIS Virtual AI Headquarters — Cloud edition

A browser-first, game-inspired AI agent workspace. The first operational room is Market Intelligence (Bitcoin price monitoring). It uses Cloudflare Workers for backend execution and cron scheduling, Cloudflare D1 for persistent memory/state, CoinGecko for market data, and Groq for AI analysis.

This project is designed to be deployed to the cloud from a browser-based GitHub + Cloudflare workflow. You do not need to run Node.js on your own PC after deployment.

## Important limitations

- The visual headquarters and room navigation are implemented; Market Intelligence is the first operational room. Content Factory, Business Ops, and Research Lab are clearly marked as planned modules, not falsely represented as active.
- Cloudflare Cron Triggers run on the configured schedule (every 5 minutes in this starter). The app honors the configured interval by checking the last stored snapshot.
- Alert records are stored in D1. This starter does not send external push notifications to Telegram/email yet.
- AI does not trade or access exchange accounts.
- Model availability, Groq quotas, and CoinGecko API limits may change.

## Deploy entirely from your browser

### 1. Create a GitHub repository

1. Open https://github.com/new
2. Create a repository named `jarvis-virtual-headquarters`.
3. Upload the files and folders in this ZIP to the repository root. GitHub web UI supports **Add file → Upload files**. Keep `src/`, `public/`, `schema.sql`, and `wrangler.toml` at the root.
4. Commit the files.

### 2. Create Cloudflare D1 database

1. Open https://dash.cloudflare.com/
2. Go to **Storage & databases → D1 SQL Database** (label may vary).
3. Create database named `jarvis-memory`.
4. Open its SQL console and run the entire contents of `schema.sql`.
5. Copy the database ID from its settings/details.

### 3. Connect the GitHub repository to Cloudflare Workers

1. In Cloudflare dashboard, open **Workers & Pages**.
2. Create an application and choose the GitHub repository/import workflow.
3. Select `jarvis-virtual-headquarters`.
4. Use the repository's `wrangler.toml` configuration. Replace `REPLACE_WITH_D1_DATABASE_ID` with the real D1 database ID and commit that change to GitHub.
5. If the dashboard asks for a build command, use the Cloudflare Workers Git integration / Wrangler deployment flow. This project has no frontend build step.
6. Confirm the D1 binding name is exactly `DB` and the static assets binding is `ASSETS`.
7. Deploy.

Cloudflare dashboard labels can change. If a particular import screen does not support Wrangler configuration, use the Workers Git integration documented at https://developers.cloudflare.com/workers/ci-cd/builds/ .

### 4. Add secrets and variables

In the deployed Worker settings, open **Settings → Variables and Secrets**:

- Add secret `GROQ_API_KEY` with your key from https://console.groq.com/keys .
- Add variable `GROQ_MODEL` with a model currently available in your Groq account, e.g. `llama-3.3-70b-versatile`.
- Optional secret `COINGECKO_API_KEY` with a CoinGecko Demo API key from https://www.coingecko.com/en/api .

Never add API keys to `public/app.js`, HTML, or a public GitHub commit. If a key was committed publicly, revoke it and create a new one.

### 5. Enable cron

In Worker settings, confirm the Cron Trigger `*/5 * * * *` exists. It should be created from `wrangler.toml`. Deploy again after any configuration edits.

### 6. Open the site

Open the deployed `*.workers.dev` URL in Chrome. Configure the Bitcoin mission and click **Run cycle now** to test the API. Then click **Activate mission**. The backend scheduler continues while the browser tab is closed, as long as the Cloudflare deployment is healthy.

## D1 binding and deployment notes

The `wrangler.toml` file includes:
- `DB` D1 database binding
- `ASSETS` static asset binding
- a five-minute Cron Trigger

Replace the placeholder D1 ID before deployment. The D1 schema must be applied before calling the API. Store credentials as Cloudflare secrets, not in source files.

## API endpoints

- `GET /api/state`
- `GET /api/health`
- `POST /api/settings`
- `POST /api/check-now`
- `POST /api/alerts/clear`
- `POST /api/memory/clear`

## Troubleshooting

- **D1_ERROR / no such table**: run `schema.sql` in the D1 database bound to the Worker.
- **GROQ_API_KEY missing**: add it as a Worker secret and redeploy if prompted.
- **Groq 401/404**: check key/model availability in Groq Console.
- **CoinGecko 429**: add a Demo API key and avoid an unnecessarily short interval.
- **No scheduled cycles**: verify the Cron Trigger is configured and monitoring is activated in the UI.
