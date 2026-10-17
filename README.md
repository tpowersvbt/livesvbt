# livesvbt
Silicon Valley Bank and Trust - the newest technology bank.

Dependency-free Node.js site: pages are generated into `dist/` by `npm run build` and served by `server.js`
(security headers, `/healthz`, and a validated `POST /api/contact` endpoint).

## Local
```
npm run build && npm start   # http://localhost:3000
npm test
```

## Deploy to Render
`render.yaml` defines a Node web service (build `npm run build`, start `npm start`, health check `/healthz`).
In the Render dashboard choose **New > Blueprint**, select this repository, and deploy; then attach the custom domain.
Optionally set `SITE_URL` at build time so `sitemap.xml` has absolute URLs.

Notes: the contact endpoint validates and logs only the topic (no personal data); wire it to an email/CRM provider before
relying on it. Online banking sign-in is a placeholder page; no real accounts are handled by this site.
