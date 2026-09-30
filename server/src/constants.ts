export const ROLE_CODES = ['ADMIN', 'A', 'B', 'C', 'D', 'AUDITOR'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const ROLES: { code: RoleCode; name: string; description: string; sort: number }[] = [
  { code: 'ADMIN', name: 'System Administrator', description: 'Manages users, masters, rules and settings. Cannot take part in payment approvals.', sort: 1 },
  { code: 'A', name: 'Payment Advice Maker — A', description: 'Creates Payment Advices, resolves queries and resubmits.', sort: 2 },
  { code: 'B', name: 'Payment Approver — B', description: 'Reviews and approves / returns Payment Advices.', sort: 3 },
  { code: 'C', name: 'Payment Maker / Account Manager — C', description: 'Verifies originals & accounting, initiates payment on the bank portal, updates bank references.', sort: 4 },
  { code: 'D', name: 'Authorised Bank Approver — D', description: 'Final review and approval of the bank payment.', sort: 5 },
  { code: 'AUDITOR', name: 'Auditor / View Only', description: 'Read-only access to payments, reports and audit trail.', sort: 6 },
];

/** Every permission the API checks. Admin UI (Roles) can toggle these per role. */
export const PERMISSIONS: { key: string; label: string; group: string }[] = [
  { key: 'payment.view', label: 'View payment advices (within scope)', group: 'Payments' },
  { key: 'payment.create', label: 'Create / edit own payment advices', group: 'Payments' },
  { key: 'payment.approve_b', label: 'Approve / return as B', group: 'Approval' },
  { key: 'payment.verify_c', label: 'Verify documents & accounting as C', group: 'Processing' },
  { key: 'payment.initiate_bank', label: 'Initiate bank payment as C', group: 'Processing' },
  { key: 'payment.bank_update', label: 'Update bank status / reconciliation', group: 'Processing' },
  { key: 'payment.approve_d', label: 'Final bank approval as D', group: 'Approval' },
  { key: 'payment.hold', label: 'Put payment on hold / release', group: 'Control' },
  { key: 'payment.cancel_request', label: 'Request / perform cancellation', group: 'Control' },
  { key: 'payment.cancel_approve', label: 'Approve cancellation requests', group: 'Control' },
  { key: 'payment.export', label: 'Export payment data to Excel', group: 'Reports' },
  { key: 'report.view', label: 'View reports', group: 'Reports' },
  { key: 'dashboard.management', label: 'Management dashboard', group: 'Reports' },
  { key: 'audit.view', label: 'View global audit trail', group: 'Audit' },
  { key: 'vendor.view', label: 'View vendor master', group: 'Masters' },
  { key: 'vendor.manage', label: 'Create / edit vendors', group: 'Masters' },
  { key: 'vendor.authorise_bank', label: 'Authorise vendor bank changes', group: 'Masters' },
  { key: 'master.view', label: 'View companies & banks', group: 'Masters' },
  { key: 'admin.access', label: 'System administration module', group: 'Admin' },
];

const ALL = PERMISSIONS.map((p) => p.key);
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleCode, string[]> = {
  ADMIN: ['payment.view', 'payment.hold', 'payment.cancel_request', 'payment.cancel_approve', 'payment.export', 'report.view', 'dashboard.management',
    'audit.view', 'vendor.view', 'vendor.manage', 'vendor.authorise_bank', 'master.view', 'admin.access'],
  A: ['payment.view', 'payment.create', 'payment.cancel_request', 'payment.export', 'report.view', 'vendor.view', 'vendor.manage', 'master.view'],
  B: ['payment.view', 'payment.approve_b', 'payment.hold', 'payment.cancel_request', 'payment.cancel_approve', 'payment.export', 'report.view',
    'dashboard.management', 'vendor.view', 'vendor.authorise_bank', 'master.view'],
  C: ['payment.view', 'payment.verify_c', 'payment.initiate_bank', 'payment.bank_update', 'payment.hold', 'payment.cancel_request', 'payment.export',
    'report.view', 'dashboard.management', 'vendor.view', 'vendor.manage', 'master.view'],
  D: ['payment.view', 'payment.approve_d', 'payment.hold', 'payment.cancel_request', 'payment.cancel_approve', 'payment.export', 'report.view',
    'dashboard.management', 'vendor.view', 'master.view'],
  AUDITOR: ['payment.view', 'payment.export', 'report.view', 'dashboard.management', 'audit.view', 'vendor.view', 'master.view'],
};
void ALL;

export interface StatusDef { code: string; label: string; color: string; sort: number; terminal?: boolean; description: string }
export const STATUSES: StatusDef[] = [
  { code: 'DRAFT', label: 'DRAFT', color: 'slate', sort: 1, description: 'Being prepared by A' },
  { code: 'SUBMITTED', label: 'SUBMITTED BY A', color: 'blue', sort: 2, description: 'Submitted by A' },
  { code: 'PENDING_B_APPROVAL', label: 'PENDING B APPROVAL', color: 'amber', sort: 3, description: 'Waiting for approval by B' },
  { code: 'B_APPROVED', label: 'B APPROVED', color: 'green', sort: 4, description: 'All required B approvals are complete' },
  { code: 'B_REJECTED', label: 'B REJECTED', color: 'red', sort: 5, description: 'Rejected / returned by B – with A' },
  { code: 'PENDING_C_VERIFICATION', label: 'PENDING C VERIFICATION', color: 'amber', sort: 6, description: 'C to verify original documents' },
  { code: 'C_QUERY', label: 'C QUERY RAISED', color: 'red', sort: 7, description: 'C raised a query – with A' },
  { code: 'A_RESUBMITTED', label: 'A RESUBMITTED', color: 'blue', sort: 8, description: 'A resolved the query and resubmitted to C' },
  { code: 'C_VERIFIED', label: 'C VERIFIED', color: 'teal', sort: 9, description: 'Original documents verified by C' },
  { code: 'ACCOUNTING_VERIFIED', label: 'ACCOUNTING VERIFIED', color: 'teal', sort: 10, description: 'Accounting treatment verified by C' },
  { code: 'PAYMENT_INITIATED', label: 'PAYMENT INITIATED', color: 'indigo', sort: 11, description: 'C initiated the payment on the bank portal' },
  { code: 'PENDING_D_APPROVAL', label: 'PENDING D APPROVAL', color: 'amber', sort: 12, description: 'Waiting for final bank approval by D' },
  { code: 'D_APPROVED', label: 'PAYMENT APPROVED', color: 'green', sort: 13, description: 'Final payment approved by D' },
  { code: 'PAYMENT_COMPLETED', label: 'PAYMENT COMPLETED', color: 'green', sort: 14, terminal: true, description: 'Debited / reconciled at the bank' },
  { code: 'D_REJECTED', label: 'D REJECTED', color: 'red', sort: 15, description: 'Rejected by D – returned' },
  { code: 'CANCELLED', label: 'CANCELLED', color: 'slate', sort: 16, terminal: true, description: 'Cancelled' },
  { code: 'ON_HOLD', label: 'ON HOLD', color: 'orange', sort: 17, description: 'Temporarily on hold' },
  { code: 'PAYMENT_FAILED', label: 'PAYMENT FAILED', color: 'red', sort: 18, description: 'Bank payment failed' },
  { code: 'PAYMENT_REVERSED', label: 'PAYMENT REVERSED', color: 'red', sort: 19, terminal: true, description: 'Payment returned / reversed by bank' },
];

export const PAYMENT_TYPES = [
  { code: 'VENDOR', name: 'Vendor' }, { code: 'SUPPLIER', name: 'Supplier' }, { code: 'CUSTOMER', name: 'Customer / Party' },
  { code: 'EMPLOYEE', name: 'Employee' }, { code: 'STATUTORY', name: 'Statutory payment' }, { code: 'TAX', name: 'Tax payment' },
  { code: 'LOAN_INTEREST', name: 'Loan / Interest' }, { code: 'INTER_COMPANY', name: 'Inter-company payment' }, { code: 'OTHER', name: 'Other approved business payment' },
];
export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
export const BANK_STATUSES = ['INITIATED', 'APPROVED', 'PROCESSED', 'FAILED', 'RETURNED', 'REVERSED', 'RECONCILED'];
export const DOC_TYPES = ['Invoice', 'Purchase Order', 'Goods/Service Receipt', 'GST Document', 'TDS Document', 'Bank Details / Cancelled Cheque', 'Contract / Agreement', 'Approval / Email', 'Corrected Document', 'Other'];

export const C_DOC_CHECKLIST = [
  ['original_invoice', 'Original Invoice Verified'],
  ['original_supporting', 'Original Supporting Documents Verified'],
  ['purchase_order', 'Purchase Order Verified'],
  ['goods_receipt', 'Goods/Service Receipt Verified'],
  ['gst_details', 'GST Details Verified'],
  ['tds_checked', 'TDS Applicable/Checked'],
  ['vendor_bank', 'Vendor Bank Details Verified'],
  ['accounting_entry', 'Accounting Entry Verified'],
  ['other_docs', 'Other Documents Verified'],
] as const;

export const D_CHECKLIST = [
  ['payment_advice', 'Payment Advice'],
  ['b_approval', 'B Approval'],
  ['supporting_documents', 'Supporting Documents'],
  ['accounting_treatment', 'Accounting Treatment'],
  ['beneficiary_details', 'Beneficiary Details'],
  ['payment_amount', 'Payment Amount'],
  ['bank_account', 'Bank Account'],
  ['payment_mode', 'Payment Mode'],
  ['c_verification', "C's Verification"],
  ['bank_portal_details', 'Bank Portal Payment Details'],
] as const;

/** Statuses in which the request is still with A (editable, subject to material-field locks after B approval). */
export const A_EDITABLE = ['DRAFT', 'B_REJECTED', 'C_QUERY', 'D_REJECTED'];

export const NOTIFICATION_EVENTS = [
  ['PAYMENT_CREATED', 'Payment created'],
  ['B_APPROVAL_PENDING', 'B approval pending'],
  ['B_APPROVED', 'B approved'],
  ['B_REJECTED', 'B rejected / returned'],
  ['C_QUERY_RAISED', 'C query raised'],
  ['A_RESUBMITTED', 'A resubmitted'],
  ['C_VERIFIED', 'C verified'],
  ['PAYMENT_INITIATED', 'Payment initiated'],
  ['D_APPROVAL_PENDING', 'D approval pending'],
  ['D_APPROVED', 'D approved (final payment approval)'],
  ['D_REJECTED', 'D rejected'],
  ['PAYMENT_COMPLETED', 'Payment completed'],
  ['PAYMENT_FAILED', 'Payment failed'],
  ['PAYMENT_CANCELLED', 'Payment cancelled'],
  ['PAYMENT_ON_HOLD', 'Payment on hold / released'],
  ['CANCELLATION_REQUESTED', 'Cancellation requested'],
] as const;
