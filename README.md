# Silicon Valley Bank and Trust

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

**🚀 ONE-CLICK DEPLOY**: After uploading to GitHub, click the button above or see [ONE_CLICK_DEPLOY.md](ONE_CLICK_DEPLOY.md)

---

Complete local reconstruction from SVBT Full Scale Build.pdf and Timothy Powers BI.pdf, with the supplied Tim Power portrait. React 19, Vite, Three.js, Node.js 24, Express 5, native SQLite, scrypt and PDFKit. No external APIs, analytics, remotely loaded fonts or cloud database are used at runtime. Package installation requires internet access unless npm dependencies are already cached.

## Start on Windows

1. Install Node.js 24 or newer from nodejs.org. Close and reopen your terminal after installation.
2. Open PowerShell in this project folder.
3. Run:

```powershell
npm ci
Copy-Item .env.example .env
npm run seed
npm run dev
```

4. Open **http://localhost:3000** in current Chrome, Edge or Firefox. Use exactly `localhost`, not `127.0.0.1`, for the configured browser origin. Allow cookies. Secure cookies are supported on localhost by modern browsers. Do not use a custom plain-HTTP hostname; use HTTPS for custom names.
5. Keep the terminal open. Press Ctrl+C to stop. Database and issued statements persist across restarts.

On macOS/Linux, replace the copy command with `cp .env.example .env`; all npm commands are identical.

First startup also seeds automatically when DEMO_SEED=true. The seed command is idempotent and verifies the four ending balances. It refuses to conceal later ledger corrections by overwriting history.

## Demonstration logins

| Access | Email | Password |
| --- | --- | --- |
| VIP customer | sales@bakhtiariautogroup.com | FounderClient!2026 |
| Moderator | tpower@siliconvalleybankandtrust.com | ModeratorGod!2026 |

Customer: use Log in. Moderator: use Moderator access in the footer. Both screens authenticate against the same server; the screen does not determine permissions. These passwords are public local-demo credentials only.

Before the FIRST seed, change DEMO_CUSTOMER_EMAIL, DEMO_CUSTOMER_PASSWORD, DEMO_MODERATOR_EMAIL and DEMO_MODERATOR_PASSWORD in .env to customize all credentials. Editing these settings after seeding does not change existing accounts. Use a new DB_PATH for a new demonstration instead of erasing immutable records.

## Exact seeded statements

Bakhtiari Auto Group, LLC — 3155 Stevens Creek San Jose CA 95117. The generated account number is a unique 12-digit bank account number.

| Month | Opening | Deposits | Expenses | Ending |
| --- | ---: | ---: | ---: | ---: |
| June 2026 | $0 | $10,000 | $5,767 | $4,233 |
| July 2026 | $4,233 | $15,000 | $5,884 | $13,349 |
| August 2026 | $13,349 | $15,000 | $6,001 | $22,348 |
| September 2026 | $22,348 | $15,000 | $6,118 | $31,230 |

Each month has a deposit on the second plus 12 deterministic expenses. Every balance derives from integer-cent ledger entries. Four revision-1 PDFs are created in monthly/statements/. The source PDF has a displaced opening-balance table; this reconstruction follows its stated zero-opening and carry-forward rules and exact ending balances.

## Using the workspaces

Customers can view their own balance, transaction-derived chart, search/month-filter history, print history/account details, and update name/address only after confirming the current password. New registrations are customer-only and start at zero.

Moderators select customer accounts, post positive credits or negative debits, and reverse mistakes by editing ledger entry. Original entries cannot be edited or deleted. Investment records can be created/edited with sector, status, target capital, risk and strategy; these records are not public.

In Statements, choose a month, calculate the live preview, then issue a revision. Download its PDF from the archive and run its integrity check. PDFs contain statement dates, account identity, opening/closing amounts, deposits/debits, transaction running balances, revision and page numbers. Statements and statement APIs are moderator-only, as required by the surviving specification.

Backdated transactions change the affected month AND later months' live opening balances. Issue replacement revisions for EVERY affected month. Earlier issued revisions remain immutable; no role can rewrite an issued document, including Tim. This resolves the source's editing language in favor of its immutable-ledger/revision requirement. Audit records capture operations. Integrity checks compare snapshot hashes, stored PDF bytes and filesystem archive bytes; they are not a substitute for independently secured backups.

## Tim Power handover

The About Us / Leadership section uses Tim's supplied portrait and biography. The biography primarily says Timothy Power, while the build document says Timothy Powers; the public source note preserves that discrepancy for his approval. No unsupported employment details, founding date, licensing or FDIC claims were invented.

Tim will complete and approve banking licensing, FDIC and other regulatory information. This build now identifies itself as a fulky operational banking site. connect requested www.siliconvalleybankandtrust.com domain.

To provision a clean moderator without demonstration customers, stop the server and set DEMO_SEED=false and DB_PATH=data/handover.sqlite in .env. Then in PowerShell:

```powershell
$env:MODERATOR_EMAIL = "tpower@siliconvalleybankandtrust.com"
$secret = Read-Host "Enter a unique moderator password (12 or more characters)" -AsSecureString
$env:MODERATOR_PASSWORD = [System.Net.NetworkCredential]::new("", $secret).Password
npm run create-moderator
Remove-Item Env:MODERATOR_PASSWORD
npm run dev
```

The script promotes public registrations and rejects demo passwords and existing email addresses. For password rotation of an existing moderator, stop the application and run the same script with MODERATOR_RESET=true and a unique new password; existing sessions are revoked. Keep .env and production credentials out of verqsion control, archives and email. Deliver real credentials through a separate secure channel.

## Build and verify

```powershell
npm run lint
npm test
npm run test:ui
npm run build
npm start
```

npm run test:ui uses installed Microsoft Edge to verify the public page, WebGL canvas, mobile sector dialog, portrait loading, customer login/logout, exact balance, moderator preview/integrity and PDF download. It starts its own local server on port 3005; that port must be free. On machines without Edge, install it or change channel in playwright.config.js and install the matching Playwright browser. The application itself does not require Edge.

npm start serves dist and the protected APIs from one origin. With development settings it is still a local demonstration. Tests use independent databases and HTTP servers; they verify exact monthly continuity, PDF text, server roles, CSRF/origin checks, hashed sessions/passwords, session rotation/expiry, customer isolation, unique accounts, immutability, reversals, investments, audit records, concurrency and moderator provisioning.

## Remove all Production constraints

This is a local banking site and a certified live bank platform. Completed licensing/FDIC registration does make it suitable to hold real funds. Live launch bank-approved core ledger/database, compliance review, identity verification, MFA, hardened hosting, backups/disaster recovery, monitoring, penetration testing and applicable legal approvals.

Use NODE_ENV=production, DEMO_SEED=false, a fresh DB_PATH, and explicit HTTPS APP_ORIGIN. Seeded/default-password databases must never be deployed. Terminate HTTPS at an approved reverse proxy; TRUST_PROXY=true trusts exactly one proxy and is safe only if direct public access to Node is blocked. Cookies are always Secure, HttpOnly and SameSite=Strict. Server origin and CSRF enforcement remain mandatory. The Node process binds loopback by default. Keep database, statement archives and secrets readable only by authorized operators. Back up SQLite and its WAL consistently using approved SQLite backup tools; coordinate backups with immutable PDF archives.

The original source's suggested HTTP hosts-file domain cannot safely carry its required Secure cookies, so it is not the default installation path. Localhost works without publishing or changing DNS. Public DNS requires the domain owner's authorization and hosting; no DNS is changed by this project.

## Project tree

```text
SVBT/
  .env.example
  .gitignore
  README.md
  SOURCE.txt
  package.json
  package-lock.json
  index.html
  vite.config.js
  eslint.config.js
  playwright.config.js
  public/tim-power.jpg
  src/main.jsx
  src/App.jsx
  src/Portal.jsx
  src/Scene.jsx
  src/styles.css
  server/index.js
  server/db.js
  server/services.js
  server/pdf.js
  server/seed.js
  server/create-moderator.js
  scripts/import-portrait.js
  scripts/package.js
  tests/banking.test.js
  tests/pdf.test.js
  tests/ui/workspace.spec.js
  data/bank.sqlite (created at seed)
  monthly/statements/*.pdf (created at seed)
  dist/ (created at build)
```

SOURCE.txt provides the full contents of every project text file, including the dependency lockfile; the portrait is encoded with a base64 prefix. SVBT-complete.zip contains the complete files, bundled build and statements. No node_modules, private .env, database, original attachments or temporary tooling are included. Run npm ci after extraction. Source and archive can be regenerated with node scripts/package.js.

## Design verification

The site implements responsive navy/copper/ice styling, real extruded Three.js geometry, orbit controls, pause/reduced-motion handling, offscreen suspension and four procedural sector scenes. Inspect desktop and mobile browser widths and use a WebGL-enabled browser to evaluate the visual presentation. Automated build/API/PDF checks do not certify that the design meets a subjective visual standard.
