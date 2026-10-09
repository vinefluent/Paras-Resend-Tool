# Paras Resend Tool (Next.js + React, Vercel-ready)

Port of the Python/Tkinter/Selenium tool. Same flow per email: fill email → Register → "Click here" → close popup.
Same behaviour: up to 10 tabs, retry rounds (max 10), 10% failure-rate pause (20 s), live stats/ETA, CSV report.

## How it works on Vercel
- `app/page.tsx`: dashboard (CSV upload, tabs, retries, failure monitor, report download). Runs in the browser.
- `app/api/run-batch/route.ts`: serverless function. Launches headless Chromium (`@sparticuz/chromium` + `playwright-core`), processes up to 5 emails, returns results.
- Each "tab" = one parallel request handling small batches (BATCH_SIZE in `lib/config.ts`), so no function runs long.

## Deploy
1. Push this folder to GitHub (or run `npx vercel` in it).
2. Optionally add the `*_XPATH` selectors in Vercel > Project > Settings > Environment Variables if your page differs (see `.env.example`).
3. Deploy. Open the URL, enter any valid HTTP(S) page URL, upload the CSV, and select Start. No access password or target-host configuration is required.

## Local dev
```
npm install
cp .env.example .env.local   # fill values + CHROME_EXECUTABLE_PATH to your Chrome
npm run dev
```

## Notes
- Hosted version cannot reach `localhost` pages; deploy/test against a public URL.
- `maxDuration` is 60 s (fits Hobby). Raise it in the route if you enlarge BATCH_SIZE.
- Target sites may rate-limit or block datacenter IPs; failed rows are retried and shown in the report.
