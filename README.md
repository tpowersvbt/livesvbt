# livesvbt

Silicon Valley Bank and Trust website: a responsive, self-contained marketing site (no runtime dependencies, no secrets) served by a small Node server.

## Local development
```
npm run build   # verifies static assets
npm start       # http://localhost:3000
npm test
```
`PORT` is read from the environment (Render sets it automatically). `/healthz` is the health check.

## Deploy to Render
1. In the Render dashboard choose **New > Blueprint** and select this repository; `render.yaml` configures everything.
   Or create a **Web Service** manually: Runtime `Node`, Build Command `npm run build`, Start Command `npm start`, Health Check Path `/healthz`.
2. Deploy. To use the custom domain, add it under the service's **Settings > Custom Domains** and update DNS as Render instructs.

No environment variables are required. The contact form is a demo and transmits no data.

Note: `banking-main (2).zip` is a previous Next.js app that needs Appwrite/Plaid/Sentry secrets and was not used here.
