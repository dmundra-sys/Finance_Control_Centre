# Pre-delivery test report

Run on 30 September 2026 against PostgreSQL 16, Node 22.

## 1. Automated API tests – 55 / 55 passed (`npm test`, ~25 s)

The suite starts the real Express app and drives it over HTTP as the demo users.

| # | Suite | Tests | Covers |
|---|---|---|---|
| 1 | Authentication & security | 7 | unauthenticated rejection, generic login error, httpOnly cookie, CSRF, password policy, lock-out and admin unlock, TOTP 2FA, recovery mobile visible to admin only |
| 2 | **Complete workflow** A → B → C → query → A → C → bank → D → WhatsApp | 11 | ₹5,25,000 advice needing a Senior approver, query with required document, resubmission of the *same* advice with version history, accounting gate, bank reference mandatory, D checklist, WhatsApp to C, document lock, UTR completion, ordered audit story |
| 3 | Immutability & audit integrity | 3 | UPDATE/DELETE blocked by triggers even from SQL, hash chain verifies, audit visibility by role |
| 4 | Rejection, return, resubmission | 2 | B rejection with mandatory reason returns to A; D rejection returns to C |
| 5 | Segregation of duties | 4 | two-role user cannot approve own payment, B→C and C→D restrictions, permission matrix, data scoping by company |
| 6 | Duplicate payment control | 2 | exact duplicate blocked with existing PA number, override only with permission and reason, same invoice/different amount flagged |
| 7 | Approval matrix | 3 | bands read from DB, two B levels + two D approvals above ₹25 lakh, payment-mode limits |
| 8 | Amendment control | 2 | locked fields, new version restarts approval, refused after bank initiation |
| 9 | Cancellation and hold | 5 | pre-/post-approval cancellation rules, second-person approval, hold/release, failed payment re-initiation |
| 10 | Documents | 2 | type/size/content validation, versions, configurable limit |
| 11 | Masters, masking, vendor bank change | 4 | account masking with audited reveal, separate authorisation of bank changes, stale-bank control, admin-only masters |
| 12 | Search, filters, dashboards, exports, reports, notifications | 10 | global search, filters, role dashboards, Excel columns, PDF with QR, all 12 reports (Excel + PDF), notifications, no credential exposure, admin functions, friendly errors |

## 2. Browser end-to-end test (Playwright, real UI) – passed, 0 console errors

One scripted run through the actual screens, five users, final run on freshly seeded data:

1. A creates a payment with an attachment and submits → PENDING B APPROVAL
2. B approves → PENDING C VERIFICATION
3. C raises a document query → C QUERY RAISED
4. A resolves it, uploads a corrected document, resubmits the same advice → A RESUBMITTED
5. C verifies originals (ticks the checklist) → C VERIFIED
6. C completes accounting (ledger, cost centre, department, project, GST, TDS, voucher, ERP) and verifies → ACCOUNTING VERIFIED
7. C records the bank-portal reference → PENDING D APPROVAL
8. D approves on a 390 px phone viewport → PAYMENT APPROVED
9. Admin's Message Outbox shows the "Payment Approved" WhatsApp message to C
10. C records the UTR → PAYMENT COMPLETED; the Audit Trail tab lists all 13 entries

Bugs found and fixed by this run: the accounting form did not mark Department and Project as required although the server requires them; the bank-status form did not default the debit date/amount (server rejected a blank date); an empty "Your action" message after completion; the payments list and approval-matrix tables clipped their right-hand columns at laptop width.

Server controls seen working through the UI during the run: missing-document block, control checklist failures, duplicate bank reference refusal ("already recorded against PA-…").

## 3. Production build smoke tests

* `tsc` build succeeds; `dist/` includes the SQL schema.
* On an **empty database**: `migrate:prod`, `create-admin:prod`, start, login, forced password change all work; base data present (6 roles, 19 statuses, 4 approval bands).
* Runtime image simulated with `npm ci --omit=dev` only: `seed:prod`, server start, login, PDF (with embedded fonts) and Excel export all work.

## 4. Visual review

Login, role dashboards (A/B/C/D), management dashboard with charts, payment list (desktop + phone), new-payment form, payment detail (all tabs), all action modals, processing queue, vendors, reports, audit trail, admin users / matrix / companies / settings / outbox / backup, profile. Checked at 1366 px and 390 px.

## 5. Not verified in this environment – please test on your side

* **Docker image build** – the sandbox has the Docker client but no daemon. The Dockerfile's steps were reproduced by hand (build, `npm ci --omit=dev`, start), but `docker compose up --build` itself has not been executed.
* **Real WhatsApp (Meta Cloud / webhook) and real SMTP delivery** – need your credentials. The provider code paths, encrypted secret storage and the MOCK provider are tested; run **Send test message** after configuring.
* **Bank API and SMS gateway** are labelled *Future Integration* by design.
* Load / performance testing at production volumes, and a penetration test, have not been done.
