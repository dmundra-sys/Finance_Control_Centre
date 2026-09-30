# Payment Approval & Banking Workflow Management System

A complete, working system for multi-company corporate finance teams. It moves every payment through a controlled, auditable chain:

```
A  creates Payment Advice  →  B  approves  →  C  verifies ORIGINAL documents + accounting,
then initiates the payment manually on the bank portal  →  D  gives final bank approval
→  WhatsApp / e-mail / in-app notice to C  →  C records UTR  →  PAYMENT COMPLETED
                         (every step recorded in a hash-chained, immutable audit trail)
```

No bank User ID, password, OTP or transaction password is ever stored or requested. C performs the bank-portal step by hand and records only the bank reference.

**Stack:** React 18 + TypeScript + Vite + Tailwind (web) · Node 22 + Express + TypeScript (API) · PostgreSQL 16. One process serves both the API and the built web app.

---

## Contents

1. [Running the system](#1-running-the-system)
2. [Database setup](#2-database-setup)
3. [Creating the administrator](#3-creating-the-administrator)
4. [Creating users](#4-creating-users)
5. [Configuring companies](#5-configuring-companies)
6. [Configuring banks](#6-configuring-banks)
7. [Configuring the approval matrix](#7-configuring-the-approval-matrix)
8. [Testing the workflow](#8-testing-the-workflow)
9. [Deploying to production](#9-deploying-to-production)
10. [Email and WhatsApp integration](#10-email-and-whatsapp-integration)
11. [Backup and recovery](#11-backup-and-recovery)
12. [Reference: roles, statuses, controls, project layout](#12-reference)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Running the system

You need **Node.js 20+** (22 recommended) and **PostgreSQL 14+** (16 recommended). Docker is optional.

### Option A – Docker (quickest, also the production route)

```bash
cp .env.example .env
#  edit .env:  set POSTGRES_PASSWORD, DATABASE_URL password, APP_BASE_URL
#  generate the encryption key:   openssl rand -hex 32   → DATA_ENCRYPTION_KEY
docker compose up -d --build
docker compose exec app node dist/scripts/create-admin.js admin "System Administrator" you@company.com 'A-Strong-Passw0rd!' 9460201308
```

Open <http://localhost:4000> and sign in as `admin`. Tables are created automatically on first start.

To load the demo company, users and 40 sample payments (not for production):

```bash
docker compose exec app node dist/scripts/seed.js
#  (add SHOW_DEMO_LOGINS=true to .env if you also want the one-click user buttons)
```

### Option B – Local development

```bash
# 1. PostgreSQL – create a role and database (see section 2)
# 2. Install and build
npm run install:all
npm run build                      # builds web/dist and server/dist

# 3. Configure (optional in development – safe defaults are built in)
export DATABASE_URL=postgres://pawf:pawf_dev_pw@localhost:5432/pawf

# 4. Load the demo data and start
npm run seed                       # creates schema + demo companies, users, 40 payments
npm start                          # http://localhost:4000
```

For hot-reload development run `npm run dev:server` and, in a second terminal, `npm run dev:web` (Vite serves on port 5173 and proxies `/api` to port 4000).

Demo sign-in: user ID `admin`, `a.anil`, `b.rajesh`, `c.sunil`, `d.vikram`, `auditor` … password **`Demo@12345`**. In development the login page lists the demo users as one-click buttons. `Demo Walkthrough` in the sidebar explains a guided run-through.

---

## 2. Database setup

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE pawf WITH LOGIN PASSWORD 'choose-a-strong-password';
CREATE DATABASE pawf OWNER pawf;
SQL
export DATABASE_URL=postgres://pawf:choose-a-strong-password@localhost:5432/pawf
npm run migrate                    # applies server/src/sql/*.sql, safe to re-run
```

* `migrate` is idempotent and also runs automatically every time the server starts.
* It creates all tables, immutability triggers on the audit log, and the **base configuration**: 6 roles with their permissions, 19 status definitions and labels, the default 4-band approval matrix, payment modes, master lists and notification templates.
* Compiled builds: `npm --prefix server run migrate:prod`.
* Development only: `npm run db:reset` drops everything and rebuilds (refuses to run when `NODE_ENV=production`).
* The database user needs `CREATE` on the database. `pg_dump`/`pg_restore` must be on the server's `PATH` for the in-app backup button.

---

## 3. Creating the administrator

The first administrator is created from the command line, so there is no default password to forget to change.

```bash
npm run create-admin -- admin "System Administrator" admin@yourcompany.com 'A-Strong-Passw0rd!' 9460201308
#   compiled / Docker:  node dist/scripts/create-admin.js <same arguments>
```

* The account is a **super-admin**; it **must change its password at first login**.
* Password policy (configurable): at least 10 characters with upper case, lower case, digit and special character; 5 failed attempts lock the account for 15 minutes; passwords expire after 90 days.
* Enable two-factor authentication under **Profile → Two-factor authentication** (any authenticator app such as Google Authenticator or Microsoft Authenticator). It is optional per user; enable it at least for the administrator and for B, C and D.
* The administrator recovery / contact mobile (default `9460201308`) is stored in **Admin → System settings → Recovery**. It appears only on that screen — never on the login page or any public page — and a super-admin can change it there (the change is audited). Running `create-admin` again with an existing login ID resets that administrator's password.
* The Administrator role manages users, masters and settings; it **cannot approve payments**. That separation is deliberate.

---

## 4. Creating users

**Admin → Users → Add user.**

| Field | Notes |
|---|---|
| Login ID, name, e-mail, mobile | Mobile is the WhatsApp number (10 digits assumes +91). |
| Role | `A` maker · `B` approver · `C` payment maker / accounts · `D` bank approver · `AUDITOR` read-only · `ADMIN`. |
| Companies | The user sees and acts only on payments of the ticked companies. |
| Bank accounts | Limit which paying bank accounts the user can see (C and D). Leave empty for "all accessible banks of the ticked companies". |
| Senior approver | Required to act on payments the matrix marks "senior". |
| Duplicate override | Allows A to submit a flagged duplicate, with a mandatory reason. |
| Can view full account number | Lets the user use **Reveal** on beneficiary accounts (each reveal is audited). Everyone else sees `XXXX XXXX 7891`. |
| Extra roles / SoD exception | Normally empty. A person can hold two roles, but can never approve their own payment (see segregation of duties below). |
| Temporary password | The user must change it at first login. |

Users can be edited, deactivated (never deleted — history stays intact), unlocked after a lock-out, and given a new temporary password. **Admin → Roles & Permissions** edits what each role may do; **Admin → Login History** shows sign-ins and failures.

---

## 5. Configuring companies

**Admin → Companies → Add company.** Enter legal name, short name (used in lists, e.g. `BOL`), PAN, GSTIN, address, and the payment-advice letterhead details. Deactivate rather than delete.

The demo data contains: Betul Oil Limited (BOL), Eyal Commodeal Private Limited, Backpack International Private Limited (BIPL), SDF, and Dermarich Aesthetics LLP.

Then give people access: edit each user and tick the companies they work on. Vendors are shared across companies but payments are always raised against exactly one company.

---

## 6. Configuring banks

**Company paying accounts** – **Admin → Bank Accounts → Add bank account**: company, bank name, branch, account number (stored **encrypted**, shown masked), IFSC, account type, portal name (e.g. "HDFC NetBanking (Corporate)") and which payment modes it supports (NEFT, RTGS, IMPS, UPI, cheque …).

**Vendor / beneficiary accounts** – **Vendors & Parties → Add vendor** and add bank details. Changing a vendor's bank account is a **separately authorised process**: the change is saved as *pending*, a different user holding *Authorise vendor bank changes* (B and Admin by default) must approve it, and a payment cannot be submitted or initiated while the beneficiary account is unauthorised or has changed since B approved.

Never enter internet-banking credentials anywhere. There is no field for them.

---

## 7. Configuring the approval matrix

**Admin → Approval Matrix.** A rule says how many B approvals (and which kind) and how many D approvals a payment needs, by amount band. The most specific matching rule wins: company + bank + department + payment type + amount band, then less specific ones. The chosen route is **frozen onto each Payment Advice when it is submitted**, so editing the matrix never changes payments already in flight.

Default rules:

| Net payable | B approvals | D approvals |
|---|---|---|
| up to ₹1,00,000 | 1 Payment Approver | 1 |
| ₹1,00,001 – ₹5,00,000 | 1 Payment Approver | 1 |
| ₹5,00,001 – ₹25,00,000 | 1 **Senior** Approver | 1 |
| above ₹25,00,000 | Payment Approver, then Senior Approver | 2 |

Use **Test the matrix** on the same screen to see the route for any company / bank / type / amount before saving. Related admin screens: **Payment Modes** (mandatory fields per mode), **Master Lists** (departments, cost centres, GL codes, GST/TDS, projects …), **Status Labels** (rename statuses, e.g. `D APPROVED` is shown as "PAYMENT APPROVED"), **Notification Templates** (WhatsApp / e-mail wording).

---

## 8. Testing the workflow

### 8.1 Automated tests (55 tests, ~25 seconds)

```bash
# needs a role "pawf" (password pawf_dev_pw) that can create tables in a database "pawf_test":
sudo -u postgres psql -c "CREATE ROLE pawf WITH LOGIN PASSWORD 'pawf_dev_pw' CREATEDB"
sudo -u postgres createdb -O pawf pawf_test
npm test          # uses postgres://pawf:pawf_dev_pw@localhost:5432/pawf_test (edit server/package.json to change)
```

The suite drives the real HTTP API and covers: login, lockout and CSRF; the complete flow **A → B → C → query → A resubmit → C verify → bank initiation → D approval → WhatsApp**; rejection and return; segregation of duties; duplicate payment control; multi-level / multi-D approval matrix; amendment control; hold and cancellation; documents and versions; vendor bank-change authorisation and account masking; audit-chain integrity and tamper resistance; search, filters, dashboards, Excel export, PDF, all reports and notifications. See [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md).

### 8.2 Manual run-through in the browser (about 10 minutes)

Load the demo data (`npm run seed`) and use a private window per user (or sign out between steps). Password for all: `Demo@12345`.

1. **`a.anil`** → *New Payment Advice*. Company Betul Oil Limited, a paying bank, vendor *ABC Suppliers*, a new invoice number, date, amount ₹1,50,000, TDS ₹1,500, attach a PDF → **Submit for approval**. Status: PENDING B APPROVAL.
2. **`b.rajesh`** → *Dashboard* shows it under "Pending my approval" → open it → **Review & decide (B)** → Approve. Status: PENDING C VERIFICATION.
3. **`c.sunil`** → *Processing Queue* → open it → **Raise query to A** ("invoice not legible"). Status: C QUERY RAISED.
4. **`a.anil`** → open it → **Resolve query & resubmit**, attach a clear copy → the *same* Payment Advice (same PA number) goes back to C. Status: A RESUBMITTED.
5. **`c.sunil`** → **Verify original documents**, tick all → Confirm. Then the **Accounting** tab: ledger, cost centre, department, project, GST treatment, TDS section 194C, voucher and ERP references, both toggles → **Save**, then **Verify accounting** (the control checklist on the right must be all green). Status: ACCOUNTING VERIFIED.
6. **`c.sunil`** → **Record bank initiation**: initiate the payment on the bank portal *outside* this system, then enter the bank reference → **Mark initiated & send to D**. Status: PENDING D APPROVAL.
7. **`d.vikram`** (try it on a phone, the screen is built for it) → **Final approval (D)** → Approve payment, tick the final-review checklist. Status: PAYMENT APPROVED.
8. **`admin`** → *Message Outbox → WhatsApp*: the "Payment Approved" message to C is there (MOCK provider).
9. **`c.sunil`** → **Update bank status** → Processed, enter the UTR → PAYMENT COMPLETED.
10. Open the **Audit Trail** tab on the payment: 13 entries, who/what/when/from where, old and new values. **`auditor`** → *Audit Trail → Verify integrity* confirms the hash chain.

Also try: B rejects (A corrects and resubmits the same advice) · D rejects and returns to A or C · A creates a payment with the same vendor and invoice number (duplicate warning; only a user with the override flag can continue, with a reason) · B tries to approve a payment they created (blocked by segregation of duties) · Hold / Cancel from the top of the payment page · Export Excel from *Payment Advices* · *Reports* (12 reports, Excel and PDF) · download the Payment Advice PDF and scan its QR code.

---

## 9. Deploying to production

### Checklist

1. **HTTPS is mandatory.** Put the app behind nginx, Caddy or a cloud load balancer that terminates TLS and forwards to port 4000. Set `APP_BASE_URL=https://your-domain`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`.
2. **Generate a fresh `DATA_ENCRYPTION_KEY`** (`openssl rand -hex 32`). The server refuses to start in production without it. Store a copy in your password manager / secret store, **separately from database backups**.
3. Use a strong `POSTGRES_PASSWORD`. Do not expose the database port publicly.
4. `SHOW_DEMO_LOGINS=false`. Do **not** run `seed` on the production database. Create the administrator with `create-admin` (section 3) and switch off *Demo mode* in System settings.
5. Mount persistent volumes for `/data/storage` (encrypted documents) and `/data/backups`.
6. Turn on scheduled backups (section 11) and copy backups off the server.
7. Enable 2FA for the administrator and for B, C and D (Profile).
8. Configure WhatsApp and e-mail (section 10) and send a test message to yourself.

### Docker Compose

```bash
cp .env.example .env && nano .env
docker compose up -d --build
docker compose logs -f app
```

### Render (GitHub → live URL, one click)

The repo contains a `render.yaml` blueprint that creates the web service (Docker), a PostgreSQL 16 database and a 5 GB persistent disk for encrypted documents.

1. Open `https://dashboard.render.com/blueprint/new?repo=<your GitHub repo URL>` (sign in with GitHub, allow access to the repo).
2. When asked for **DEMO_PASSWORD**, choose a password (it is used by every demo user, including `admin`). Click **Deploy Blueprint**.
3. First start takes a few minutes. The address shown on the service (`https://payment-approval-workflow-xxxx.onrender.com`) is your app. Sign in as `admin` with your DEMO_PASSWORD.
4. `DATA_ENCRYPTION_KEY` is generated for you: open the service → Environment and copy it somewhere safe.
5. `SEED_DEMO_DATA=true` loads the sample companies, users and 40 payments **only into a completely empty database**. For real use, delete that variable and DEMO_PASSWORD, redeploy on a fresh database and create your administrator from the service **Shell**: `node dist/scripts/create-admin.js admin "Name" you@company.com 'Password' 9460201308`.

The plans in `render.yaml` are paid ones (a disk and a non-expiring database need them); change them in the file or dashboard if you prefer.

### Without Docker (systemd example)

```bash
npm run install:all && npm run build
cd server && npm ci --omit=dev
```

```ini
# /etc/systemd/system/pawf.service
[Unit]
Description=Payment Approval & Banking Workflow
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/pawf/server
EnvironmentFile=/opt/pawf/.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
User=pawf

[Install]
WantedBy=multi-user.target
```

Example Caddy reverse proxy: `payments.example.com { reverse_proxy localhost:4000 }`.

### Upgrading

Pull the new code, `docker compose up -d --build` (or rebuild and restart the service). Migrations run at start-up. Take a backup first.

### Security controls built in

bcrypt password hashing · opaque server-side sessions (httpOnly, SameSite=Strict cookie) with idle and absolute timeouts · CSRF token on every state-changing request · rate-limited login and lock-out · optional TOTP 2FA · strict Content-Security-Policy and security headers · AES-256-GCM encryption of bank account numbers, 2FA secrets, provider tokens and stored documents · account numbers masked everywhere with audited reveal · role-based access from the database plus company and bank scoping on every query · maker-checker segregation of duties · immutable, hash-chained audit trail (database triggers block UPDATE and DELETE; integrity can be verified from the UI) · no credentials or secrets ever sent to the browser.

---

## 10. Email and WhatsApp integration

All provider settings live in **Admin → System settings** (WhatsApp / E-mail / SMS tabs). Secrets you type there are **encrypted in the database and never returned to the browser** (the form only shows "saved"). The browser never talks to WhatsApp or the mail server; the API server sends everything from a queue (the **Message Outbox**), retrying failures. Nothing is hard-coded in the front end.

### WhatsApp

Provider options:

* **MOCK** (default) – nothing leaves the server; messages appear in *Message Outbox → WhatsApp* like a chat. Use it to demonstrate and test.
* **META_CLOUD** – the official WhatsApp Business Cloud API. You need a Meta Business account, a WhatsApp phone number, its **Phone number ID**, a **permanent access token**, and — for business-initiated messages — an approved **template**.
* **WEBHOOK** – posts JSON `{to, text, template, variables}` with `Authorization: Bearer <token>` to your own gateway or BSP URL.

For `META_CLOUD`: choose the provider, enter Phone number ID, API version (default `v20.0`), paste the access token, and (recommended) the template name and language. The template body must take **nine text variables, in this order**:

`{{1}} PA number · {{2}} company · {{3}} vendor · {{4}} amount · {{5}} bank · {{6}} approved by · {{7}} approval date · {{8}} bank reference · {{9}} status`

Leave the template name empty to send a plain-text message (works only inside the 24-hour customer-service window). Edit the wording in *Notification Templates*. The mobile number on each user's profile is the recipient (10-digit numbers get +91). Alternatively supply the token as the environment variable `WHATSAPP_ACCESS_TOKEN`.

The message sent to C when D approves reads:

```
Payment Approved
Payment Advice No: PA-2026-000001
Company: …   Vendor: …   Amount: ₹…   Bank: …
Approved By: …   Approval Date: …   Bank Reference: …
Status: FINAL PAYMENT APPROVED
```

### E-mail (SMTP)

Choose **SMTP**, then host, port (587 STARTTLS or 465 with *secure* on), user, password, from name and address (or set `SMTP_PASSWORD` in the environment). Use **Send test e-mail** to verify. E-mail carries the same events as WhatsApp plus password-reset links and approval requests.

### SMS

Shown as **Future Integration**: the notification channel, templates and outbox already exist and a gateway can be plugged in at `server/src/services/providers/messaging.ts`.

### Bank API

Bank integration is marked **Future Integration** (`MANUAL` provider). The current design — C initiates on the bank portal and records the reference — is deliberate and needs no bank credentials.

### Sending schedule

The outbox is processed every 30 seconds; **Send pending now** forces a run.

---

## 11. Backup and recovery

### What to back up

1. The PostgreSQL database.
2. The document storage folder (`STORAGE_DIR`, default `/data/storage` in Docker).
3. The **`DATA_ENCRYPTION_KEY`** — without it encrypted account numbers, 2FA secrets and stored documents are unreadable. Keep it in a secret store, separate from the backups.

### Backups from the application

**Admin → Backup & Recovery → Back up now** creates a PostgreSQL custom-format dump (`pawf-….dump`) that can be downloaded. Under **System settings → Backup schedule** enable a daily backup at a set time (IST) with a retention period in days. Copy the backup folder to remote storage (cron + `rclone`/`aws s3 sync`).

Command-line equivalent:

```bash
pg_dump -Fc "$DATABASE_URL" -f pawf-$(date +%F).dump
tar czf storage-$(date +%F).tgz /data/storage
```

### Restore

1. Stop the application (or use maintenance mode on the proxy).
2. Create an empty database and restore:  
   `pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" pawf-backup.dump`
3. Restore the storage folder to `STORAGE_DIR`.
4. Start the application with the **same** `DATA_ENCRYPTION_KEY`.
5. Sign in as administrator → **Audit Trail → Verify integrity**. It re-computes every hash link and reports `ok` or the first broken entry.

### Lost administrator password

Run `create-admin` again with the same login ID: it resets that administrator's password and forces a change at next login. Use the recovery mobile in System settings as the emergency contact for your own procedures. Restore drills: test a restore into a scratch database at least quarterly.

---

## 12. Reference

### Roles

| Role | Can | Cannot |
|---|---|---|
| **A** – Payment Advice maker | Create, edit drafts, submit, resolve queries and resubmit, request cancellation | Approve, verify, initiate |
| **B** – Payment approver | Approve / reject / return; hold; authorise vendor bank changes | Approve own or A-role payments they created |
| **C** – Payment maker / accounts | Verify **original** documents, raise queries, complete accounting, initiate on the bank portal and record the reference, update bank status | Give D approval |
| **D** – Bank approver | Final approval or rejection (with return-to A or C) | Initiate payments |
| **Admin** | Users, masters, matrix, settings, backup, outbox | Take part in any approval |
| **Auditor** | Read-only view, reports, audit trail | Change anything |

### Statuses

DRAFT · SUBMITTED · PENDING B APPROVAL · B APPROVED · PENDING C VERIFICATION · C QUERY RAISED · A RESUBMITTED · C VERIFIED · ACCOUNTING VERIFIED · PAYMENT INITIATED · PENDING D APPROVAL · D APPROVED (shown as *PAYMENT APPROVED*) · PAYMENT COMPLETED · B REJECTED · D REJECTED · CANCELLED · ON HOLD · PAYMENT FAILED · PAYMENT REVERSED. Labels, colours and order are editable in *Status Labels*.

### Key controls

* **Segregation of duties** – the creator (A) can never approve or process their own advice; C cannot give D approval and D cannot process a payment; a B approver of a payment cannot give its final D approval; B cannot do C's verification unless the user carries the *SoD exception* flag (audited); multiple D approvals must come from different people.
* **Duplicate control** – the same vendor with the same invoice number (case- and space-insensitive) is flagged at submission, as an *exact* duplicate when invoice date, amount and company also match. Cancelled and reversed advices are ignored. Only users with the duplicate-override flag may proceed, and they must give a reason (audited).
* **Accounting control checklist** – bank initiation is blocked until originals, supporting document, GL/cost centre/department/project, GST and TDS, voucher and ERP references, ledger and debit/credit-note checks, arithmetic reconciliation to the advice and vendor bank authorisation all pass.
* **Amendment control** – editing an approved advice creates a new version, resets approvals and shows old vs new values.
* **Bank-reference uniqueness** – a bank reference or UTR can be recorded against one payment only.
* **Audit trail** – every action, with user, role, time, IP, old and new values, remarks; hash-chained; cannot be edited or deleted.

### Excel export

*Payment Advices → Export Excel* exports the current filter with these columns: Payment Advice No · Date · Company · Vendor · Invoice No · Invoice Date · Amount · TDS · Net Payable · Payment Mode · Bank · Created By · B Approved By · B Approval Date · C Verified By · C Verification Date · Bank Reference · D Approved By · D Approval Date · Status · Remarks. Twelve further reports (register, pending, vendor-, company-, bank-, user-wise, rejected, query/resubmission, ageing, completed, failed …) export to Excel and PDF from *Reports*.

### Project layout

```
server/                    Express API (TypeScript, ESM)
  src/sql/001_schema.sql   schema, triggers, base configuration
  src/services/            workflow, approval matrix, audit, notifications, PDF, Excel, reports
  src/routes/              REST endpoints
  src/scripts/             migrate · seed · create-admin · reset
  test/e2e.test.ts         55 API tests
web/                       React + Vite + Tailwind single-page app
docs/TEST_REPORT.md        results of the pre-delivery test run
Dockerfile · docker-compose.yml · .env.example
```

### Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection | local dev DB |
| `DATA_ENCRYPTION_KEY` | 32-byte hex key (required in production) | dev key |
| `APP_BASE_URL` | Public URL (QR codes, links) | `http://localhost:4000` |
| `PORT` | HTTP port | `4000` |
| `COOKIE_SECURE`, `TRUST_PROXY` | HTTPS cookie / proxy trust | `true` / `false` in production |
| `SHOW_DEMO_LOGINS` | Demo user buttons on login page | `false` in production |
| `STORAGE_DIR`, `BACKUP_DIR` | Document and backup folders | `server/storage`, `server/backups` |
| `WHATSAPP_ACCESS_TOKEN`, `SMTP_PASSWORD` | Optional secrets via environment | — |
| `BCRYPT_ROUNDS` | Password hashing cost | `12` |

---

## 13. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Missing required environment variable DATA_ENCRYPTION_KEY` | Production needs the key; `openssl rand -hex 32`. |
| Blank page or 404 on `/login` | The web app is not built. Run `npm run build`, then restart. |
| Can't sign in over plain HTTP in production | `COOKIE_SECURE=true` needs HTTPS; use a TLS proxy (or `COOKIE_SECURE=false` on a private test box only). |
| "Account locked" | Wait for the lock-out to expire, or Admin → Users → Unlock. |
| Backup button fails | `pg_dump` not installed on the server; install `postgresql-client`. |
| WhatsApp shows FAILED in outbox | Open the message: the provider's error is stored with it. Check token, phone number ID and template approval. |
| Cannot verify accounting | Read the red items in the *Control checklist*; the server states exactly what is missing. |
| Cannot record bank initiation | The bank reference is already used by another payment, or accounting is not verified. |
