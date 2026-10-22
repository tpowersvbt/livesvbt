# Owner editing handover — 9 October 2026

Target service: `svbt-rkqn`; deployment branch: `tpowersvbt-powers-superhand`; root directory: `SVBT`.

The two new failed Blueprint services use the older `master` branch. They are not the live handover service.

## Changes

- The existing staff account `tpower@siliconvalleybankandtrust.com` is promoted to owner once on production startup. This does not create a public default password or change the account's password. If that email belongs to a customer, startup refuses promotion.
- Owners can add customer/staff accounts and assign customer, moderator, administrator or owner permissions. Role changes invalidate the affected user's sessions. Owners cannot demote themselves or remove the last owner.
- Owners and administrators can edit customer names, addresses and account numbers, and publish homepage copy, sector information and disclosures.
- Existing project, leadership, investment, transaction and statement tools remain available to staff.
- Public review/sample banners and workspace demo wording are removed. Previously issued statements and sample ledger records are not rewritten or deleted.
- Site content uses plain text, version checks and audit entries. It does not accept executable HTML.

## Before merging / deploying

Confirm that the currently used SQLite database and statement directory are on persistent storage, and take a consistent SQLite backup. The Render connector did not expose a disk in its service response, and its disk-event search returned no records. This does not prove a disk is absent, but persistence has not been verified. Do not change DB_PATH to a new empty directory or restart an ephemeral service until existing data has been safely backed up.

Merging into the deployment branch automatically redeploys the existing service. No extra Blueprint is needed.

## After deployment

1. Verify `/api/health` returns `ok`.
2. Sign out, then sign in through Staff login using Tim's existing password.
3. Confirm owner access and the Users & permissions, Site content and Customer details tabs.
4. Verify existing account records and issued statements remain present.
5. Review and publish the bank's final disclosure text and leadership biography using their editors.

Application owner access is separate from ownership of Render, GitHub and the domain registrar. Those account memberships are not changed by this patch.


## Owner design and statement controls — October 13, 2026

Owners and administrators now use **Design & wording** to publish the site palette, button and hover colors, navigation, sign-in wording, homepage copy, disclosures, workspace labels and statement headings. Individual wording and colors can be reset to their defaults. Project content and leadership details retain their dedicated editors.

In **Statements**, select the account and month, save statement notes, calculate the preview, then issue a new revision. Notes are included in the new PDF. Unsaved notes block issuance in the editor.

**Edit details** beside a transaction lets an editor save a reference ID, occurrence date/time and notes. The browser uses the operator's device timezone and stores the occurrence timestamp in UTC; PDFs label the timestamp as UTC. The generated ledger entry ID, posting timestamp, ledger date and amount retain their recorded values. Corrections continue through recorded reversals. Existing original PDFs and snapshots retain their hashes.

The new data is stored in additive SQLite tables on the existing persistent disk. Publishing design settings does not change any credentials.
