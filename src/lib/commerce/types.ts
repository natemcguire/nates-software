export class CommerceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommerceError';
  }
}

export class StripeVerificationError extends CommerceError {
  public statusCode: number;
  constructor(message: string, statusCode = 401) {
    super(message);
    this.name = 'StripeVerificationError';
    this.statusCode = statusCode;
  }
}

export class InboxCollisionError extends CommerceError {
  public statusCode: number;
  constructor(message: string) {
    super(message);
    this.name = 'InboxCollisionError';
    this.statusCode = 409;
  }
}

export class OrderTransitionError extends CommerceError {
  constructor(message: string) {
    super(message);
    this.name = 'OrderTransitionError';
  }
}

export class LicenseCryptoError extends CommerceError {
  constructor(message: string) {
    super(message);
    this.name = 'LicenseCryptoError';
  }
}

export type InboxEventStatus =
  | 'received'
  | 'processing'
  | 'processed'
  | 'retryable_failure'
  | 'terminal_failure';

export type CommerceOrderStatus =
  | 'creating'
  | 'requires_payment'
  | 'processing'
  | 'paid'
  | 'fulfilling'
  | 'fulfilled'
  | 'payment_failed'
  | 'cancelled'
  | 'refunded'
  | 'disputed';

export type OutboxTransferStatus =
  | 'pending'
  | 'processing'
  | 'retryable_failure'
  | 'succeeded'
  | 'terminal_failure'
  | 'cancelled';

export interface StripeSignatureResult {
  valid: boolean;
  timestamp?: number;
  reason?: string;
}

export interface EncryptedSecretPayload {
  ciphertextBase64: string;
  ivBase64: string;
  algorithm: 'AES-256-GCM';
  keyVersion: number;
}

export interface ProcessEventResult {
  success: boolean;
  skipped?: boolean;
  duplicate?: boolean;
  terminal?: boolean;
  retryable?: boolean;
  fulfilledByPeer?: boolean;
  orderId?: string;
  licenseId?: string;
  licenseKeyLast4?: string;
  outboxCount?: number;
  status?: string;
  error?: string;
  reason?: string;
}
