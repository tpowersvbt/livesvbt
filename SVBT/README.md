# SVBT — Mr. Powers operations handoff

Prepared from the supplied ffee4f56379c0707ec2a423e51a9cbc8c86ec6f4 archive.
The uploaded archive is older than commit c435297 shown in the deployment log.
This package is a reviewed replacement based on the supplied archive, not a merge of that later commit.

## Moderator login

Choose **Moderator login** in the top navigation or **Moderator access** in the footer.
The email and password are supplied privately in Render's environment settings:

| Variable | Value |
| --- | --- |
| NODE_ENV | production |
| APP_ORIGIN | Exact HTTPS address used to open this site, without a trailing slash |
| MODERATOR_EMAIL | Mr. Powers' chosen email (the last deployment used misterchrismac@gmail.com) |
| MODERATOR_PASSWORD | A unique password of 12 or more characters; never place it in GitHub |
| MODERATOR_NAME | Timothy Powers |
| DEMO_SEED | false |
| SAMPLE_DATA | true |
| TRUST_PROXY | true |
| DB_PATH | /var/data/bank.sqlite |
| STATEMENT_DIR | /var/data/statements |

The moderator is created automatically on first startup. An existing moderator's password
and role are preserved. Changing an environment password does not silently reset an account.
For an intentional reset, set MODERATOR_RESET=true and run `npm run create-moderator`
in the service shell, then remove MODERATOR_RESET. This invalidates the old sessions.
To create an owner (full access, including Users and the demo import) instead of a moderator,
set MODERATOR_ROLE=owner before running `npm run create-moderator`. The script only creates new
accounts or rotates a password; it never changes the role of an existing account.
No public default moderator password is supplied. A new sample customer gets an unknown,
random password; the moderator can review its ledger without a customer login.

## Production bootstrap

1. Set the variables above in Render's Environment settings. Never put a password in GitHub,
   render.yaml or any file in this repository, and never use a demonstration password in production.
2. Keep DEMO_SEED=false. The server refuses to start in production with demo seeding on.
3. Open the Render Shell for the service and run `npm run create-moderator`
   (add MODERATOR_ROLE=owner for an owner account).
4. Sign in through **Moderator access** in the footer.

## Four months of statements

June, July, August and September 2026 remain available for the operations team.
The first run creates the supplied sample ledger and four issued PDFs. Further starts
reuse the same records and PDF hashes. No database files are deleted on startup.
Existing user passwords are not replaced by sample setup. An unmarked ledger that already
has activity is left untouched and startup stops rather than mixing sample transactions into it.
Existing issued PDFs are immutable and are not rewritten; older PDFs can retain prior wording.
New PDFs say **SAMPLE RECORD - No real funds**.

## Deployment

1. Back up the current database and statement files before updating. Do not delete them.
2. Replace the source with this package in the existing SVBT repository after reviewing
   any changes made since the supplied archive. Never upload node_modules, .env or database files.
3. Configure the environment above. Updating render.yaml does not automatically populate
   new `sync: false` variables on an existing service; set them in Render directly.
4. Attach persistent storage and keep both DB_PATH and STATEMENT_DIR under its mount.
   The included Render blueprint selects the paid Starter plan and a 1 GB persistent disk;
   it is a configuration file only, and no service or paid resource has been created here.
   If moving existing records to /var/data, migrate the backed-up data before startup.
5. Build: `npm ci && npm run build`. Start: `NODE_ENV=production npm start`.
6. Confirm `/api/health`, sign in as moderator, open the sample customer, and download
   all four statements. Restart once and confirm the same records remain.

Render reference: https://render.com/docs/blueprint-spec
Persistent storage: https://render.com/docs/disks

## Scope for compliance review

Visible "demo" wording has been replaced with neutral workspace language. Sample records
and the absence of real funds remain identified. Developer fixture names retain "demo"
for compatibility with existing tests and metadata; these are not public branding.
This is deployable application source for operations review, not a certification of a
regulated banking service. There is no connected core banking, payment settlement or live
deposit integration in the supplied project. The compliance office should supply final
public disclosures and confirm the leadership biography/name before public release.

No changes have been pushed to GitHub or deployed to Render by this handoff.
See VALIDATION.md for the checks actually run.
