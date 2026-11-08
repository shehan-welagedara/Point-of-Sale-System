# Changelog

Every release, newest first. The "For clients" part is what you send to clients as release notes.

## 1.0.0 — 2026-11-08

**Type:** First release for client deployments

### For clients

- Phone and tablet POS app in two styles (Bright and Indigo), chosen by your administrator.
- Bill designer: choose what your bills print, with a preview.
- Stronger security: PINs are checked by the server, and too many wrong PINs lock an employee, also for manager approvals. Approvers now tap their name (or swipe their card) and enter their PIN.
- The POS keeps working through short internet drops and shows a notice while offline.
- Screens show when a new version is available and update themselves when nobody is signed in.

### Changes

- Mobile POS styles, bill designer, POS options, user and training manuals.
- Server-side PIN and card checks with lockout; secrets unreadable to clients; business creation restricted; verified email for invitations.
- Security headers (CSP, HSTS…); dependency updates (React Router 7, zod 4).
- Offline-tolerant writes, error screen and error reports, device status, System status page.
- One build for every client; version.json and update banner; release pipeline with backups and data migrations.
