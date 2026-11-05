# Validation — 2026-10-03

- Vite production build: passed.
- ESLint: passed.
- Backend/PDF regression suite: 11 tests passed in the first run; one secure-cookie regression was corrected and its targeted rerun passed. All 12 test cases have passed.
- Added regression coverage: first production-mode operations startup, configured moderator password, four monthly statement records, unknown sample-customer password, restart preserving passwords/statement hashes/transaction count, existing-customer reuse without duplicate email.
- Existing browser suite: 3 passed (desktop/mobile public site, customer login/logout, moderator login, statement integrity and PDF download).
- Visible copy scanned for demo/demonstration wording; remaining internal fixture identifiers are intentionally retained.

Tests ran locally on Node 24.19.0. No Render deployment, live login, DNS verification,
banking integration verification or compliance approval was performed. The final two
sidebar/print copy changes were followed by a fresh build; browser interaction tests
preceded those text-only changes.
