-- =====================================================================
--  PAYMENT APPROVAL & BANKING WORKFLOW  –  PostgreSQL schema  (v1)
--  Conventions: bigint identity keys, timestamptz, numeric(16,2) money.
--  Immutable tables are protected by triggers (no UPDATE / DELETE).
-- =====================================================================

-- ---------- reference / security ----------
CREATE TABLE roles (
  code        text PRIMARY KEY,               -- ADMIN | A | B | C | D | AUDITOR
  name        text NOT NULL,
  description text,
  sort_order  int  NOT NULL DEFAULT 0
);

CREATE TABLE role_permissions (
  role_code  text NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission text NOT NULL,
  PRIMARY KEY (role_code, permission)
);

CREATE TABLE users (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  login_id              text NOT NULL,
  password_hash         text NOT NULL,
  name                  text NOT NULL,
  email                 text NOT NULL,
  mobile                text,
  employee_code         text,
  role_code             text NOT NULL REFERENCES roles(code),
  extra_roles           text[] NOT NULL DEFAULT '{}',
  is_active             boolean NOT NULL DEFAULT true,
  is_super_admin        boolean NOT NULL DEFAULT false,
  is_senior_approver    boolean NOT NULL DEFAULT false,
  can_view_full_account boolean NOT NULL DEFAULT false,
  can_override_duplicate boolean NOT NULL DEFAULT false,
  sod_exception         boolean NOT NULL DEFAULT false,  -- authorised B+C dual-duty
  failed_attempts       int NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  must_change_password  boolean NOT NULL DEFAULT false,
  password_changed_at   timestamptz NOT NULL DEFAULT now(),
  two_factor_enabled    boolean NOT NULL DEFAULT false,
  two_factor_secret_enc text,
  last_login_at         timestamptz,
  is_demo               boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_login_lower_uq ON users (lower(login_id));
CREATE UNIQUE INDEX users_employee_code_uq ON users (employee_code) WHERE employee_code IS NOT NULL AND employee_code <> '';
CREATE INDEX users_role_idx ON users (role_code);

CREATE TABLE sessions (
  id               text PRIMARY KEY,               -- sha256(session token)
  user_id          bigint NOT NULL REFERENCES users(id),
  csrf_token       text NOT NULL,
  remember         boolean NOT NULL DEFAULT false,
  ip               text,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE password_reset_tokens (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE login_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint REFERENCES users(id),
  login_id    text,
  success     boolean NOT NULL,
  reason      text,
  ip          text,
  user_agent  text,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_history_user_idx ON login_history (user_id, at DESC);

CREATE TABLE system_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_by  bigint REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- masters ----------
CREATE TABLE companies (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         text NOT NULL,
  short_name   text NOT NULL,
  cin          text,
  pan          text,
  gstin        text,
  tan          text,
  address      text,
  logo_data    text,                              -- optional data: URL (<=200KB)
  is_active    boolean NOT NULL DEFAULT true,
  is_demo      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX companies_name_uq ON companies (lower(name));
CREATE UNIQUE INDEX companies_short_uq ON companies (lower(short_name));

CREATE TABLE bank_accounts (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id         bigint NOT NULL REFERENCES companies(id),
  bank_name          text NOT NULL,
  account_name       text NOT NULL,
  account_number_enc text NOT NULL,               -- AES-256-GCM
  account_last4      text NOT NULL,
  ifsc               text NOT NULL,
  branch             text,
  account_type       text NOT NULL DEFAULT 'CURRENT',
  bank_portal        text,
  is_active          boolean NOT NULL DEFAULT true,
  is_demo            boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bank_accounts_company_idx ON bank_accounts (company_id);

CREATE TABLE user_companies (
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id bigint NOT NULL REFERENCES companies(id),
  PRIMARY KEY (user_id, company_id)
);
CREATE TABLE user_bank_accounts (
  user_id         bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_account_id bigint NOT NULL REFERENCES bank_accounts(id),
  PRIMARY KEY (user_id, bank_account_id)
);

CREATE TABLE vendors (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vendor_code          text NOT NULL,
  name                 text NOT NULL,
  party_type           text NOT NULL DEFAULT 'VENDOR',
  pan                  text,
  gstin                text,
  address              text,
  contact_person       text,
  email                text,
  mobile               text,
  bank_name            text,
  bank_account_enc     text,
  bank_account_last4   text,
  ifsc                 text,
  account_type         text,
  bank_authorised_at   timestamptz,
  bank_authorised_by   bigint REFERENCES users(id),
  msme_status          text NOT NULL DEFAULT 'NOT_MSME',   -- NOT_MSME | MICRO | SMALL | MEDIUM
  tds_section          text,
  gst_registration     text NOT NULL DEFAULT 'REGISTERED', -- REGISTERED | UNREGISTERED | COMPOSITION | SEZ | OVERSEAS
  is_active            boolean NOT NULL DEFAULT true,
  is_demo              boolean NOT NULL DEFAULT false,
  created_by           bigint REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vendors_code_uq ON vendors (lower(vendor_code));
CREATE INDEX vendors_name_idx ON vendors (lower(name));

CREATE TABLE vendor_bank_change_requests (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vendor_id           bigint NOT NULL REFERENCES vendors(id),
  requested_by        bigint NOT NULL REFERENCES users(id),
  requested_at        timestamptz NOT NULL DEFAULT now(),
  new_bank_name       text NOT NULL,
  new_account_enc     text NOT NULL,
  new_account_last4   text NOT NULL,
  new_ifsc            text NOT NULL,
  new_account_type    text NOT NULL,
  reason              text NOT NULL,
  status              text NOT NULL DEFAULT 'PENDING',   -- PENDING | APPROVED | REJECTED
  decided_by          bigint REFERENCES users(id),
  decided_at          timestamptz,
  decision_remarks    text
);
CREATE INDEX vbcr_status_idx ON vendor_bank_change_requests (status);

CREATE TABLE vendor_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vendor_id   bigint NOT NULL REFERENCES vendors(id),
  changed_by  bigint REFERENCES users(id),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  change_type text NOT NULL,       -- CREATED | UPDATED | BANK_CHANGE_REQUESTED | BANK_CHANGE_APPROVED | BANK_CHANGE_REJECTED | STATUS
  field_name  text,
  old_value   text,
  new_value   text,
  remarks     text
);
CREATE INDEX vendor_history_vendor_idx ON vendor_history (vendor_id, changed_at);

CREATE TABLE master_data (               -- ledgers, cost centres, departments, projects, GST treatments, TDS sections, payment types
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category   text NOT NULL,
  code       text NOT NULL,
  name       text NOT NULL,
  meta       jsonb NOT NULL DEFAULT '{}',
  sort_order int NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (category, code)
);

CREATE TABLE payment_modes (
  code            text PRIMARY KEY,
  name            text NOT NULL,
  min_amount      numeric(16,2),
  max_amount      numeric(16,2),
  required_fields text[] NOT NULL DEFAULT '{}',   -- bank_ref_no, cheque_no, cheque_date, dd_no, dd_favouring, upi_id, ...
  requires_beneficiary_bank boolean NOT NULL DEFAULT true,
  sort_order      int NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true
);

CREATE TABLE status_config (
  code        text PRIMARY KEY,
  label       text NOT NULL,
  color       text NOT NULL DEFAULT 'slate',
  sort_order  int NOT NULL DEFAULT 0,
  description text,
  is_terminal boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true
);

CREATE TABLE approval_matrix (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            text NOT NULL,
  company_id      bigint REFERENCES companies(id),       -- NULL = any
  department      text,
  bank_account_id bigint REFERENCES bank_accounts(id),
  payment_type    text,
  min_amount      numeric(16,2) NOT NULL DEFAULT 0,
  max_amount      numeric(16,2),                          -- NULL = unbounded
  b_levels        jsonb NOT NULL,                         -- [{label, senior, count}]
  d_count         int NOT NULL DEFAULT 1,
  sort_order      int NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------- payments ----------
CREATE TABLE payment_sequences (
  year    int PRIMARY KEY,
  last_no int NOT NULL DEFAULT 0
);

CREATE TABLE payment_advises (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pa_number          text NOT NULL UNIQUE,
  pa_year            int  NOT NULL,
  company_id         bigint NOT NULL REFERENCES companies(id),
  bank_account_id    bigint NOT NULL REFERENCES bank_accounts(id),
  vendor_id          bigint NOT NULL REFERENCES vendors(id),
  payment_type       text NOT NULL,
  payment_mode       text NOT NULL REFERENCES payment_modes(code),
  priority           text NOT NULL DEFAULT 'NORMAL',
  department         text,
  invoice_number     text NOT NULL,
  invoice_date       date NOT NULL,
  po_number          text,
  grn_reference      text,
  gross_amount       numeric(16,2) NOT NULL,
  gst_amount         numeric(16,2) NOT NULL DEFAULT 0,
  tds_amount         numeric(16,2) NOT NULL DEFAULT 0,
  other_deduction    numeric(16,2) NOT NULL DEFAULT 0,
  advance_adjustment numeric(16,2) NOT NULL DEFAULT 0,
  net_payable        numeric(16,2) NOT NULL,
  due_date           date NOT NULL,
  purpose            text,
  remarks            text,
  -- beneficiary snapshot (frozen at submission)
  beneficiary_name        text,
  beneficiary_bank_name   text,
  beneficiary_account_enc text,
  beneficiary_account_last4 text,
  beneficiary_ifsc        text,
  status             text NOT NULL DEFAULT 'DRAFT' REFERENCES status_config(code),
  return_to_stage    text,                         -- A | B | C | D : who currently owes an action after a return
  version_no         int NOT NULL DEFAULT 1,
  approval_round     int NOT NULL DEFAULT 1,       -- increments whenever B approvals restart
  bank_round         int NOT NULL DEFAULT 0,       -- increments with each bank initiation
  is_amendment       boolean NOT NULL DEFAULT false,
  pending_b_level    int,
  pending_b_senior   boolean NOT NULL DEFAULT false,
  matrix_id          bigint REFERENCES approval_matrix(id),
  approval_plan      jsonb,                        -- {b_levels:[...], d_count:n} frozen at submission
  duplicate_override_reason text,
  duplicate_override_by     bigint REFERENCES users(id),
  duplicate_of       text,
  hold_previous_status text,
  hold_reason        text,
  cancel_reason      text,
  created_by         bigint NOT NULL REFERENCES users(id),
  is_demo            boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  submitted_at       timestamptz,
  final_approved_at  timestamptz,
  completed_at       timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (gross_amount > 0),
  CHECK (net_payable >= 0)
);
CREATE INDEX pa_status_idx  ON payment_advises (status);
CREATE INDEX pa_company_idx ON payment_advises (company_id);
CREATE INDEX pa_vendor_idx  ON payment_advises (vendor_id);
CREATE INDEX pa_creator_idx ON payment_advises (created_by);
CREATE INDEX pa_created_idx ON payment_advises (created_at);
CREATE INDEX pa_bank_idx    ON payment_advises (bank_account_id);
CREATE INDEX pa_dup_idx     ON payment_advises (vendor_id, company_id, invoice_date, gross_amount, lower(invoice_number));

CREATE TABLE payment_items (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id  bigint NOT NULL REFERENCES payment_advises(id),
  line_no     int NOT NULL,
  description text NOT NULL,
  hsn_sac     text,
  quantity    numeric(14,3) NOT NULL DEFAULT 1,
  rate        numeric(16,2) NOT NULL DEFAULT 0,
  amount      numeric(16,2) NOT NULL DEFAULT 0,
  gst_rate    numeric(5,2)  NOT NULL DEFAULT 0
);
CREATE INDEX payment_items_pa_idx ON payment_items (payment_id);

CREATE TABLE payment_versions (                 -- immutable
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id  bigint NOT NULL REFERENCES payment_advises(id),
  version_no  int NOT NULL,
  reason      text NOT NULL,                    -- SUBMITTED | RESUBMITTED | AMENDMENT
  snapshot    jsonb NOT NULL,
  created_by  bigint NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, version_no)
);

CREATE TABLE payment_documents (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id        bigint NOT NULL REFERENCES payment_advises(id),
  group_id          bigint,                     -- id of first document in a version series
  version           int NOT NULL DEFAULT 1,
  doc_name          text NOT NULL,
  doc_type          text NOT NULL,
  original_filename text NOT NULL,
  storage_key       text NOT NULL,
  mime_type         text NOT NULL,
  size_bytes        bigint NOT NULL,
  sha256            text NOT NULL,
  status            text NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | SUPERSEDED | REMOVED
  payment_version_no int NOT NULL DEFAULT 1,
  uploaded_by       bigint NOT NULL REFERENCES users(id),
  uploaded_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_documents_pa_idx ON payment_documents (payment_id);

CREATE TABLE payment_approvals (                -- immutable
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id   bigint NOT NULL REFERENCES payment_advises(id),
  stage        text NOT NULL,                   -- B | D
  round_no     int NOT NULL DEFAULT 1,          -- B: approval_round, D: bank_round
  level_no     int NOT NULL DEFAULT 1,
  level_label  text,
  approver_id  bigint NOT NULL REFERENCES users(id),
  decision     text NOT NULL,                   -- APPROVED | REJECTED | RETURNED
  reason       text,
  remarks      text,
  checklist    jsonb,
  return_to_stage text,
  decided_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_approvals_pa_idx ON payment_approvals (payment_id, stage);

CREATE TABLE payment_queries (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id          bigint NOT NULL REFERENCES payment_advises(id),
  version_no          int NOT NULL,
  raised_by_stage     text NOT NULL,             -- B | C | D
  raised_by           bigint NOT NULL REFERENCES users(id),
  category            text NOT NULL,             -- REJECTION | RETURN | DISCREPANCY | D_REJECTION
  reason              text NOT NULL,
  remarks             text,
  required_document   text,
  required_correction text,
  return_to_stage     text NOT NULL DEFAULT 'A',
  status              text NOT NULL DEFAULT 'OPEN',   -- OPEN | RESOLVED
  raised_at           timestamptz NOT NULL DEFAULT now(),
  resolved_by         bigint REFERENCES users(id),
  resolved_at         timestamptz,
  resolution_remarks  text
);
CREATE INDEX payment_queries_pa_idx ON payment_queries (payment_id);

CREATE TABLE payment_resubmissions (            -- immutable
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id     bigint NOT NULL REFERENCES payment_advises(id),
  query_id       bigint REFERENCES payment_queries(id),
  from_version   int NOT NULL,
  to_version     int NOT NULL,
  submitted_by   bigint NOT NULL REFERENCES users(id),
  to_stage       text NOT NULL,                 -- B | C
  is_amendment   boolean NOT NULL DEFAULT false,
  remarks        text,
  changes        jsonb,
  submitted_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_verifications (           -- immutable
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id          bigint NOT NULL REFERENCES payment_advises(id),
  version_no          int NOT NULL,
  verifier_id         bigint NOT NULL REFERENCES users(id),
  checklist           jsonb NOT NULL,
  result              text NOT NULL,            -- VERIFIED | DISCREPANCY
  remarks             text,
  required_document   text,
  required_correction text,
  verified_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_verifications_pa_idx ON document_verifications (payment_id);

CREATE TABLE accounting_entries (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id           bigint NOT NULL UNIQUE REFERENCES payment_advises(id),
  ledger_account       text,
  cost_centre          text,
  department           text,
  project              text,
  gst_treatment        text,
  tds_section          text,
  tds_amount           numeric(16,2),
  gst_amount           numeric(16,2),
  basic_amount         numeric(16,2),
  other_deductions     numeric(16,2),
  advance_adjustment   numeric(16,2),
  net_payable          numeric(16,2),
  voucher_no           text,
  accounting_date      date,
  erp_reference        text,
  control_flags        jsonb NOT NULL DEFAULT '{}',  -- debit_credit_note_checked, vendor_ledger_checked ...
  verified             boolean NOT NULL DEFAULT false,
  verified_by          bigint REFERENCES users(id),
  verified_at          timestamptz,
  updated_by           bigint REFERENCES users(id),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bank_transactions (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id         bigint NOT NULL REFERENCES payment_advises(id),
  seq_no             int NOT NULL,
  is_current         boolean NOT NULL DEFAULT true,
  bank_account_id    bigint NOT NULL REFERENCES bank_accounts(id),
  bank_name          text NOT NULL,
  payment_mode       text NOT NULL,
  bank_portal        text,
  bank_ref_no        text,
  initiated_at       timestamptz NOT NULL,
  initiated_by       bigint NOT NULL REFERENCES users(id),
  amount             numeric(16,2) NOT NULL,
  beneficiary_name   text NOT NULL,
  beneficiary_account_last4 text,
  utr                text,
  bank_txn_id        text,
  actual_debit_date  date,
  actual_debit_amount numeric(16,2),
  bank_status        text NOT NULL DEFAULT 'INITIATED',  -- INITIATED | APPROVED | PROCESSED | FAILED | RETURNED | REVERSED | RECONCILED
  mode_details       jsonb NOT NULL DEFAULT '{}',
  remarks            text,
  updated_by         bigint REFERENCES users(id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, seq_no)
);
CREATE INDEX bank_txn_ref_idx ON bank_transactions (bank_ref_no);
CREATE INDEX bank_txn_utr_idx ON bank_transactions (utr);

CREATE TABLE cancellation_requests (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id       bigint NOT NULL REFERENCES payment_advises(id),
  kind             text NOT NULL,                 -- PRE_FINAL | POST_FINAL
  status_at_request text NOT NULL,
  reason           text NOT NULL,
  requested_by     bigint NOT NULL REFERENCES users(id),
  requested_at     timestamptz NOT NULL DEFAULT now(),
  status           text NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | REJECTED
  decided_by       bigint REFERENCES users(id),
  decided_at       timestamptz,
  decision_remarks text
);
CREATE INDEX cancel_req_pa_idx ON cancellation_requests (payment_id);

CREATE TABLE payment_status_history (            -- immutable
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id  bigint NOT NULL REFERENCES payment_advises(id),
  from_status text,
  to_status   text NOT NULL,
  changed_by  bigint REFERENCES users(id),
  remarks     text,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX psh_pa_idx ON payment_status_history (payment_id, id);

-- ---------- notifications ----------
CREATE TABLE notifications (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id),
  payment_id bigint REFERENCES payment_advises(id),
  event_code text NOT NULL,
  title      text NOT NULL,
  body       text,
  link       text,
  is_read    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, is_read, created_at DESC);

CREATE TABLE notification_templates (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_code text NOT NULL,
  channel    text NOT NULL,                        -- INAPP | EMAIL | WHATSAPP | SMS
  is_enabled boolean NOT NULL DEFAULT true,
  subject    text,
  body       text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_code, channel)
);

CREATE TABLE notification_outbox (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel           text NOT NULL,
  recipient_user_id bigint REFERENCES users(id),
  to_address        text,
  event_code        text NOT NULL,
  payment_id        bigint REFERENCES payment_advises(id),
  subject           text,
  body              text NOT NULL,
  html              text,
  status            text NOT NULL DEFAULT 'PENDING',  -- PENDING | SENT | FAILED | SKIPPED
  attempts          int NOT NULL DEFAULT 0,
  provider          text,
  provider_ref      text,
  response          jsonb,
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz
);
CREATE INDEX outbox_status_idx ON notification_outbox (status, created_at);

-- ---------- audit ----------
CREATE TABLE audit_logs (                        -- immutable, hash-chained
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL,
  user_id     bigint,
  user_login  text,
  user_name   text,
  role_code   text,
  action      text NOT NULL,
  entity_type text,
  entity_id   text,
  payment_id  bigint,
  ip          text,
  user_agent  text,
  old_value   jsonb,
  new_value   jsonb,
  remarks     text,
  prev_hash   text,
  hash        text NOT NULL
);
CREATE INDEX audit_payment_idx ON audit_logs (payment_id, id);
CREATE INDEX audit_user_idx ON audit_logs (user_id, id);
CREATE INDEX audit_action_idx ON audit_logs (action);
CREATE INDEX audit_at_idx ON audit_logs (at);

-- ---------- immutability ----------
CREATE OR REPLACE FUNCTION pawf_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is immutable: % is not permitted', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION pawf_forbid_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION pawf_forbid_mutation();
CREATE TRIGGER psh_immutable BEFORE UPDATE OR DELETE ON payment_status_history FOR EACH ROW EXECUTE FUNCTION pawf_forbid_mutation();
CREATE TRIGGER pver_immutable BEFORE UPDATE OR DELETE ON payment_versions FOR EACH ROW EXECUTE FUNCTION pawf_forbid_mutation();
CREATE TRIGGER papp_immutable BEFORE UPDATE OR DELETE ON payment_approvals FOR EACH ROW EXECUTE FUNCTION pawf_forbid_mutation();
CREATE TRIGGER presub_immutable BEFORE UPDATE OR DELETE ON payment_resubmissions FOR EACH ROW EXECUTE FUNCTION pawf_forbid_mutation();
CREATE TRIGGER dver_immutable BEFORE UPDATE OR DELETE ON document_verifications FOR EACH ROW EXECUTE FUNCTION pawf_forbid_mutation();
CREATE TRIGGER vhist_immutable BEFORE UPDATE OR DELETE ON vendor_history FOR EACH ROW EXECUTE FUNCTION pawf_forbid_mutation();
CREATE TRIGGER lhist_immutable BEFORE UPDATE OR DELETE ON login_history FOR EACH ROW EXECUTE FUNCTION pawf_forbid_mutation();

-- payment advises and documents can never be hard-deleted
CREATE TRIGGER pa_no_delete   BEFORE DELETE ON payment_advises  FOR EACH ROW EXECUTE FUNCTION pawf_forbid_mutation();
CREATE TRIGGER pdoc_no_delete BEFORE DELETE ON payment_documents FOR EACH ROW EXECUTE FUNCTION pawf_forbid_mutation();
CREATE TRIGGER pqry_no_delete BEFORE DELETE ON payment_queries  FOR EACH ROW EXECUTE FUNCTION pawf_forbid_mutation();
CREATE TRIGGER btx_no_delete  BEFORE DELETE ON bank_transactions FOR EACH ROW EXECUTE FUNCTION pawf_forbid_mutation();

-- documents: once the payment is finally approved, nothing about a document may change except nothing at all
CREATE OR REPLACE FUNCTION pawf_lock_docs_after_final() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM payment_advises WHERE id = OLD.payment_id;
  IF st IN ('D_APPROVED','PAYMENT_COMPLETED','PAYMENT_REVERSED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Documents cannot be changed or removed after final payment approval' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER pdoc_lock_after_final BEFORE UPDATE ON payment_documents FOR EACH ROW EXECUTE FUNCTION pawf_lock_docs_after_final();
