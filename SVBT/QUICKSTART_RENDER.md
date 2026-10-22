# SVBT handoff

See HANDOFF.md for the current moderator setup, sample statements, deployment steps and limitations.

Production bootstrap: set MODERATOR_EMAIL and MODERATOR_PASSWORD in Render's Environment settings
(never in this repository), keep DEMO_SEED=false, then run `npm run create-moderator` in the Render
Shell. Add MODERATOR_ROLE=owner to create an owner. Never use a demonstration password in production.
See the "Production bootstrap" section of README.md.
