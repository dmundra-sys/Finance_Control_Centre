/**
 * Bank integration seam.
 *
 * Version 1 is MANUAL: user C initiates the transfer on the bank's own web portal and then records the
 * bank reference / UTR here. The application never stores or sees internet-banking credentials, OTPs or
 * transaction passwords.
 *
 * To integrate an officially authorised bank API later:
 *   1. implement `BankProvider` (e.g. KotakApiProvider) – build payloads from `PaymentInstruction`, verify webhook signatures
 *   2. register it in `providers` below and select it in Admin ▸ Settings ▸ Bank Integration
 *   3. call `provider.submit()` from workflow.initiateBank(), and `provider.onStatusWebhook()` from a signed webhook route
 * Flow: initiate in app → API → bank portal → authorised approval → UTR received → app updated automatically.
 */
export interface PaymentInstruction {
  paNumber: string; amount: number; mode: string; debitAccountRef: string;
  beneficiaryName: string; beneficiaryAccountRef: string; beneficiaryIfsc: string; narration: string;
}
export interface BankSubmitResult { accepted: boolean; bankReference?: string; message?: string }
export interface BankStatusUpdate { bankReference: string; status: 'INITIATED' | 'APPROVED' | 'PROCESSED' | 'FAILED' | 'RETURNED' | 'REVERSED' | 'RECONCILED'; utr?: string; debitDate?: string; debitAmount?: number }

export interface BankProvider {
  readonly name: string;
  readonly mode: 'MANUAL' | 'API';
  submit?(instruction: PaymentInstruction): Promise<BankSubmitResult>;
  fetchStatus?(bankReference: string): Promise<BankStatusUpdate | null>;
}

export const ManualBankProvider: BankProvider = { name: 'Manual (bank portal)', mode: 'MANUAL' };

export const bankProviders: Record<string, BankProvider> = {
  MANUAL: ManualBankProvider,
  // KOTAK_API: new KotakApiProvider(...)   ← Future Integration
};
export const getBankProvider = (key: string) => bankProviders[key] ?? ManualBankProvider;
