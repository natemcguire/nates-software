// Certified Mailer Domain Model & Pure Business Logic
// Offline/Local-First Certified Mail Preparation & Evidence Journaling

export const CERTIFIED_MAILER_STORAGE_KEY = 'nates_certified_mailer_v1';
export const CERTIFIED_MAILER_STORE_VERSION = 1;

export const US_STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU', 'AS', 'MP'
] as const;

export type USStateCode = typeof US_STATE_CODES[number];

export const US_STATES: readonly { code: USStateCode; name: string }[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
  { code: 'AS', name: 'American Samoa' },
  { code: 'GU', name: 'Guam' },
  { code: 'MP', name: 'Northern Mariana Islands' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'VI', name: 'U.S. Virgin Islands' }
];

export interface USAddress {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
}

export type MailLifecycleStatus =
  | 'draft'
  | 'ready_to_print'
  | 'mailed'
  | 'delivered'
  | 'returned'
  | 'closed';

export type EvidenceType =
  | 'acceptance_receipt'
  | 'tracking_event'
  | 'delivery_receipt'
  | 'return_notice'
  | 'other';

export interface EvidenceRecord {
  id: string;
  type: EvidenceType;
  title: string;
  source: string;
  observedDate: string; // YYYY-MM-DD
  reference?: string;
  notes?: string;
  createdAt: string; // ISO 8601
}

export interface LifecycleEvent {
  id: string;
  fromStatus: MailLifecycleStatus;
  toStatus: MailLifecycleStatus;
  timestamp: string; // ISO 8601
  notes?: string;
  evidenceId?: string;
}

export interface MailPiece {
  id: string;
  title: string;
  referenceNumber?: string;
  category?: string;
  statutoryReference?: string;
  sender: USAddress;
  recipient: USAddress;
  subject: string;
  body: string;
  trackingNumber?: string; // Optional, user-entered, unverified
  status: MailLifecycleStatus;
  history: LifecycleEvent[];
  evidence: EvidenceRecord[];
  notes?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface CertifiedMailerStore {
  version: 1;
  activePieceId: string | null;
  pieces: MailPiece[];
  lastExportedAt?: string;
}

export interface DisputeStarterTemplate {
  id: string;
  name: string;
  category: string;
  statutoryReference: string;
  sampleRecipient: Partial<USAddress>;
  subject: string;
  bodyTemplate: string;
  instructions: string;
}

// ---------------------------------------------------------------------------
// STARTER TEMPLATES (Explicitly marked as samples / starting points)
// Senders are completely blank so user must enter their own truthful data.
// ---------------------------------------------------------------------------
export const STARTER_TEMPLATES: readonly DisputeStarterTemplate[] = [
  {
    id: 'security-deposit',
    name: 'Security Deposit Return Demand',
    category: 'Tenant Rights',
    statutoryReference: '',
    sampleRecipient: {
      name: '[Landlord or Property Management Co.]',
      addressLine1: '[Street Address or P.O. Box]',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701'
    },
    subject: 'Formal Demand for Return of Security Deposit - [Rental Property Address]',
    bodyTemplate: `This letter records my written request for the return of my security deposit in the amount of $[Deposit Amount] regarding the residential tenancy at [Rental Unit Address], which ended on [Move-Out Date].

My forwarding address was provided on [Date]. To date, I have not received [describe any refund, accounting, or response actually received].

Please send the requested refund or a written explanation to my forwarding address by [Requested Response Date].`,
    instructions: 'Drafting starter only—not a statement of your legal rights. Fill in only facts you can verify and obtain jurisdiction-specific advice when needed.'
  },
  {
    id: 'fcra-623',
    name: 'FCRA § 623 Direct Furnisher Dispute',
    category: 'Consumer Rights',
    statutoryReference: '',
    sampleRecipient: {
      name: '[Creditor / Data Furnisher Dispute Dept]',
      addressLine1: '[P.O. Box or Corporate Address]',
      city: 'Atlanta',
      state: 'GA',
      postalCode: '30374'
    },
    subject: 'Direct Dispute of Erroneous Account Reporting - Ref #[Account Number]',
    bodyTemplate: `I am writing to dispute information concerning Account #[Account Number] that I believe is inaccurate.

Specifically, the reporting contains the following factual errors:
[Detail error: e.g. late payment recorded for Month/Year when account was current or paid in full].

Please review the enclosed supporting records, correct any information you determine is inaccurate, and send your written findings to my address.`,
    instructions: 'Drafting starter only—not legal advice. Specify the exact record, the factual error, and the evidence you are enclosing; verify the correct recipient and any deadlines independently.'
  },
  {
    id: 'fdcpa-cease',
    name: 'FDCPA Cease Communication & Validation',
    category: 'Debt Defense',
    statutoryReference: '',
    sampleRecipient: {
      name: '[Collection Agency Name]',
      addressLine1: '[P.O. Box or Street Address]',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92193'
    },
    subject: 'Cease Communications & Request for Debt Validation - File #[File Ref]',
    bodyTemplate: `I request that you stop contacting me through [list phone numbers, email addresses, or other channels] regarding reference #[File Ref]. Please direct any written response to the mailing address above.

I dispute [describe the specific amount, identity, ownership, or other fact you contest]. Please provide the records you rely on, including [list the documents or itemization requested].

I am keeping a record of this request and any response.`,
    instructions: 'Drafting starter only—not a claim that a particular law applies. Verify your rights, recipient, wording, and deadlines for your circumstances.'
  },
  {
    id: 'foia-records',
    name: 'FOIA / Public Records Request',
    category: 'Open Government',
    statutoryReference: '',
    sampleRecipient: {
      name: '[Agency / City Public Information Office]',
      addressLine1: '[Street Address or P.O. Box]',
      city: 'Austin',
      state: 'TX',
      postalCode: '78767'
    },
    subject: 'Public Information Request - [Subject Matter / Records Description]',
    bodyTemplate: `I request copies of the following records under the public-records law that applies to this agency:

1. [Specify documents, emails, permits, or contracts requested]
2. [Specify date range: e.g. January 1, 2025 through August 1, 2026]

If any portion of this request is withheld or redacted, please state the specific statutory exemption relied upon. If estimated processing fees exceed $25.00, please inform me prior to fulfillment.`,
    instructions: 'Drafting starter only. Identify the agency, applicable jurisdiction, specific records, date bounds, fee preference, and submission rules.'
  },
  {
    id: 'general-notice',
    name: 'General Formal Legal Notice',
    category: 'General Notice',
    statutoryReference: '',
    sampleRecipient: {
      name: '[Company or Recipient Name]',
      addressLine1: '[Street Address]',
      city: 'New York',
      state: 'NY',
      postalCode: '10001'
    },
    subject: 'Formal Written Notice Concerning [Contract / Agreement / Matter]',
    bodyTemplate: `Please accept this correspondence as formal written notice pursuant to our agreement dated [Date of Agreement] regarding [Matter / Claim / Warranty].

[Provide clear chronological facts, specific contract clauses or expectations, and the remedy requested].

Please provide written acknowledgment of receipt and your formal response within 10 business days.`,
    instructions: 'General-purpose formal written notice with dated paper trail.'
  }
];

// ---------------------------------------------------------------------------
// VALIDATION HELPERS
// ---------------------------------------------------------------------------

export interface AddressValidationResult {
  isValid: boolean;
  errors: Partial<Record<keyof USAddress, string>>;
}

export function validateUSAddress(address?: Partial<USAddress> | null): AddressValidationResult {
  const errors: Partial<Record<keyof USAddress, string>> = {};

  if (!address) {
    return {
      isValid: false,
      errors: {
        name: 'Recipient / sender name is required',
        addressLine1: 'Street address line 1 is required',
        city: 'City is required',
        state: 'State is required',
        postalCode: 'ZIP code is required'
      }
    };
  }

  const name = (address.name || '').trim();
  if (!name) {
    errors.name = 'Name is required (1-100 characters)';
  } else if (name.length > 100) {
    errors.name = 'Name must not exceed 100 characters';
  }

  const line1 = (address.addressLine1 || '').trim();
  if (!line1) {
    errors.addressLine1 = 'Street address line 1 is required (1-120 characters)';
  } else if (line1.length > 120) {
    errors.addressLine1 = 'Street address line 1 must not exceed 120 characters';
  }

  if (address.addressLine2) {
    const line2 = address.addressLine2.trim();
    if (line2.length > 120) {
      errors.addressLine2 = 'Address line 2 must not exceed 120 characters';
    }
  }

  const city = (address.city || '').trim();
  if (!city) {
    errors.city = 'City is required (1-60 characters)';
  } else if (city.length > 60) {
    errors.city = 'City must not exceed 60 characters';
  }

  const state = (address.state || '').trim().toUpperCase();
  if (!state) {
    errors.state = 'State code is required';
  } else if (!US_STATE_CODES.includes(state as USStateCode)) {
    errors.state = 'State must be a valid 2-letter US state or territory abbreviation';
  }

  const zip = (address.postalCode || '').trim();
  if (!zip) {
    errors.postalCode = 'ZIP code is required';
  } else {
    const zipClean = zip.replace(/\s+/g, '');
    const isFiveDigit = /^\d{5}$/.test(zipClean);
    const isNineDigit = /^\d{5}-\d{4}$/.test(zipClean) || /^\d{9}$/.test(zipClean);
    if (!isFiveDigit && !isNineDigit) {
      errors.postalCode = 'ZIP code must be 5 digits (e.g. 12345) or ZIP+4 (e.g. 12345-6789)';
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

export function normalizeTrackingNumber(raw?: string | null): string {
  if (!raw) return '';
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function formatTrackingNumberForDisplay(raw?: string | null): string {
  const norm = normalizeTrackingNumber(raw);
  if (!norm) return '';
  if (/^\d{20,22}$/.test(norm)) {
    // Group in 4s for readability e.g. 9407 1118 9956 2210 4401 22
    const parts: string[] = [];
    for (let i = 0; i < norm.length; i += 4) {
      parts.push(norm.slice(i, i + 4));
    }
    return parts.join(' ');
  }
  return norm;
}

export interface TrackingValidationResult {
  isValid: boolean;
  normalized: string;
  formatted: string;
  error?: string;
  isProvided: boolean;
}

export function validateTrackingNumber(raw?: string | null): TrackingValidationResult {
  const norm = normalizeTrackingNumber(raw);
  if (!norm) {
    return {
      isValid: true,
      normalized: '',
      formatted: '',
      isProvided: false
    };
  }

  // Plausible USPS Certified Mail tracking formats:
  // 1) 20 to 22 numeric digits (standard domestic electronic/retail barcode numbers, e.g. 9407..., 7020...)
  // 2) 13 alphanumeric S10 UPU format (e.g. EA123456789US)
  const is20to22Digits = /^\d{20,22}$/.test(norm);
  const isS10Format = /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(norm);

  if (!is20to22Digits && !isS10Format) {
    return {
      isValid: false,
      normalized: norm,
      formatted: norm,
      isProvided: true,
      error: 'Tracking number must be a plausible 20-22 digit USPS Certified Mail number or 13-character S10 code, or left blank (unverified).'
    };
  }

  return {
    isValid: true,
    normalized: norm,
    formatted: formatTrackingNumberForDisplay(norm),
    isProvided: true
  };
}

export interface MailPieceValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  senderErrors: Partial<Record<keyof USAddress, string>>;
  recipientErrors: Partial<Record<keyof USAddress, string>>;
}

export function validateMailPiece(piece: Partial<MailPiece> | null): MailPieceValidationResult {
  const errors: Record<string, string> = {};
  if (!piece) {
    return {
      isValid: false,
      errors: { general: 'Mail piece is required' },
      senderErrors: {},
      recipientErrors: {}
    };
  }

  const title = (piece.title || '').trim();
  if (!title) {
    errors.title = 'Title is required (1-150 characters)';
  } else if (title.length > 150) {
    errors.title = 'Title must not exceed 150 characters';
  }

  const subject = (piece.subject || '').trim();
  if (!subject) {
    errors.subject = 'Subject line is required (1-300 characters)';
  } else if (subject.length > 300) {
    errors.subject = 'Subject line must not exceed 300 characters';
  }

  const body = (piece.body || '').trim();
  if (!body) {
    errors.body = 'Letter body content is required (1-20,000 characters)';
  } else if (body.length > 20000) {
    errors.body = 'Letter body exceeds maximum safe bound of 20,000 characters';
  }

  const unresolvedPlaceholder = /\[[^\]\r\n]{1,160}\]/;
  const placeholderFields = [
    piece.title,
    piece.subject,
    piece.body,
    piece.sender?.name,
    piece.sender?.addressLine1,
    piece.sender?.addressLine2,
    piece.sender?.city,
    piece.recipient?.name,
    piece.recipient?.addressLine1,
    piece.recipient?.addressLine2,
    piece.recipient?.city
  ];
  if (placeholderFields.some(value => unresolvedPlaceholder.test(value || ''))) {
    errors.placeholders = 'Replace every bracketed starter-template placeholder with your own facts.';
  }

  const senderVal = validateUSAddress(piece.sender);
  const recipientVal = validateUSAddress(piece.recipient);

  const trackingVal = validateTrackingNumber(piece.trackingNumber);
  if (!trackingVal.isValid && trackingVal.error) {
    errors.trackingNumber = trackingVal.error;
  }

  const isValid =
    Object.keys(errors).length === 0 &&
    senderVal.isValid &&
    recipientVal.isValid;

  return {
    isValid,
    errors,
    senderErrors: senderVal.errors,
    recipientErrors: recipientVal.errors
  };
}

export interface EvidenceValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

export function validateEvidenceRecord(record?: Partial<EvidenceRecord> | null): EvidenceValidationResult {
  const errors: Record<string, string> = {};
  if (!record) {
    return { isValid: false, errors: { general: 'Evidence record is required' } };
  }

  const title = (record.title || '').trim();
  if (!title) {
    errors.title = 'Evidence title is required (1-120 characters)';
  } else if (title.length > 120) {
    errors.title = 'Evidence title must not exceed 120 characters';
  }

  const source = (record.source || '').trim();
  if (!source) {
    errors.source = 'Evidence source is required (e.g. Post Office Counter PS 3800, USPS.com)';
  } else if (source.length > 150) {
    errors.source = 'Source must not exceed 150 characters';
  }

  const observedDate = (record.observedDate || '').trim();
  if (!observedDate) {
    errors.observedDate = 'Observed date is required (YYYY-MM-DD)';
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(observedDate)) {
    errors.observedDate = 'Observed date must be in YYYY-MM-DD format';
  } else {
    const [year, month, day] = observedDate.split('-').map(Number);
    const d = new Date(Date.UTC(year, month - 1, day));
    if (
      Number.isNaN(d.getTime()) ||
      d.getUTCFullYear() !== year ||
      d.getUTCMonth() !== month - 1 ||
      d.getUTCDate() !== day
    ) {
      errors.observedDate = 'Observed date is invalid';
    }
  }

  const validTypes: EvidenceType[] = [
    'acceptance_receipt',
    'tracking_event',
    'delivery_receipt',
    'return_notice',
    'other'
  ];
  if (!record.type || !validTypes.includes(record.type)) {
    errors.type = 'A valid evidence type must be selected';
  }

  if (record.notes && record.notes.length > 2000) {
    errors.notes = 'Notes must not exceed 2,000 characters';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

// ---------------------------------------------------------------------------
// LIFECYCLE & STATE TRANSITIONS
// ---------------------------------------------------------------------------

export interface TransitionGuardResult {
  allowed: boolean;
  reason?: string;
  missingRequirements: string[];
}

export function canTransitionStatus(
  piece: MailPiece,
  targetStatus: MailLifecycleStatus,
  userConfirmed = false,
  pendingEvidence?: Partial<EvidenceRecord>
): TransitionGuardResult {
  const missing: string[] = [];

  if (piece.status === targetStatus) {
    return {
      allowed: true,
      missingRequirements: []
    };
  }

  switch (targetStatus) {
    case 'draft': {
      // Can transition back to draft if currently ready_to_print
      if (piece.status !== 'ready_to_print') {
        return {
          allowed: false,
          reason: `Cannot revert to draft from status "${piece.status}". Only ready-to-print mail pieces can return to draft for editing.`,
          missingRequirements: ['Current status must be ready_to_print']
        };
      }
      return { allowed: true, missingRequirements: [] };
    }

    case 'ready_to_print': {
      if (piece.status !== 'draft') {
        return {
          allowed: false,
          reason: `Cannot mark ready to print from status "${piece.status}". Only draft mail pieces can transition to ready to print.`,
          missingRequirements: ['Current status must be draft']
        };
      }

      // Must have valid sender, recipient, subject, body
      const validation = validateMailPiece(piece);
      if (!validation.isValid) {
        if (Object.keys(validation.senderErrors).length > 0) {
          missing.push('Complete valid sender mailing address');
        }
        if (Object.keys(validation.recipientErrors).length > 0) {
          missing.push('Complete valid recipient mailing address');
        }
        if (validation.errors.title) missing.push(validation.errors.title);
        if (validation.errors.subject) missing.push(validation.errors.subject);
        if (validation.errors.body) missing.push(validation.errors.body);
        if (validation.errors.trackingNumber) missing.push(validation.errors.trackingNumber);

        return {
          allowed: false,
          reason: 'Cannot mark ready to print until all addresses and letter fields are valid.',
          missingRequirements: missing
        };
      }
      return { allowed: true, missingRequirements: [] };
    }

    case 'mailed': {
      if (piece.status !== 'ready_to_print') {
        return {
          allowed: false,
          reason: `Cannot mark mailed from status "${piece.status}". Review and mark the mail piece ready to print first.`,
          missingRequirements: ['Current status must be ready_to_print']
        };
      }

      const validation = validateMailPiece(piece);
      if (!validation.isValid) {
        missing.push('Valid letter contents and addresses');
      }

      if (!userConfirmed) {
        missing.push('Explicit user confirmation of postal deposit / mailing');
      }

      // Check evidence requirement: must have at least one acceptance receipt or tracking event,
      // or a valid pending evidence record being attached in this step
      const hasPendingAcceptance =
        pendingEvidence &&
        (pendingEvidence.type === 'acceptance_receipt' || pendingEvidence.type === 'tracking_event') &&
        validateEvidenceRecord(pendingEvidence).isValid;

      if (!hasPendingAcceptance) {
        missing.push(
          'User-entered mailing evidence (e.g. Post Office acceptance receipt, PS 3800 counter stamp, or initial tracking entry)'
        );
      }

      return {
        allowed: missing.length === 0,
        reason: missing.length > 0 ? 'Mailing requirements not satisfied.' : undefined,
        missingRequirements: missing
      };
    }

    case 'delivered': {
      if (piece.status !== 'mailed') {
        return {
          allowed: false,
          reason: 'Cannot mark delivered unless the mail piece is in "mailed" status.',
          missingRequirements: ['Status must be "mailed"']
        };
      }

      if (!userConfirmed) {
        missing.push('Explicit user confirmation of delivery observation');
      }

      const hasPendingDelivery =
        pendingEvidence &&
        (pendingEvidence.type === 'delivery_receipt' || pendingEvidence.type === 'tracking_event') &&
        validateEvidenceRecord(pendingEvidence).isValid;

      if (!hasPendingDelivery) {
        missing.push(
          'A new user-entered delivery observation (e.g. signed Return Receipt PS 3811 green card, or a tracking event you observed)'
        );
      }

      return {
        allowed: missing.length === 0,
        reason: missing.length > 0 ? 'Delivery requirements not satisfied.' : undefined,
        missingRequirements: missing
      };
    }

    case 'returned': {
      if (piece.status !== 'mailed') {
        return {
          allowed: false,
          reason: 'Cannot mark returned unless the mail piece is in "mailed" status.',
          missingRequirements: ['Status must be "mailed"']
        };
      }

      if (!userConfirmed) {
        missing.push('Explicit user confirmation of return to sender');
      }

      const hasPendingReturn =
        pendingEvidence &&
        (pendingEvidence.type === 'return_notice' || pendingEvidence.type === 'tracking_event') &&
        validateEvidenceRecord(pendingEvidence).isValid;

      if (!hasPendingReturn) {
        missing.push(
          'User-entered return evidence (e.g. Return to Sender postal marking, undeliverable notice, or tracking notice)'
        );
      }

      return {
        allowed: missing.length === 0,
        reason: missing.length > 0 ? 'Return requirements not satisfied.' : undefined,
        missingRequirements: missing
      };
    }

    case 'closed': {
      if (piece.status === 'draft') {
        missing.push('Cannot close an unfinalized draft without deleting or archiving');
      }
      if (!userConfirmed) {
        missing.push('Explicit user confirmation to close mail piece record');
      }

      return {
        allowed: missing.length === 0,
        reason: missing.length > 0 ? 'Closure requirements not satisfied.' : undefined,
        missingRequirements: missing
      };
    }

    default:
      return {
        allowed: false,
        reason: `Unknown target status: ${targetStatus}`,
        missingRequirements: ['Invalid status']
      };
  }
}

export function transitionMailPieceStatus(
  piece: MailPiece,
  targetStatus: MailLifecycleStatus,
  options: {
    userConfirmed?: boolean;
    notes?: string;
    newEvidence?: Partial<EvidenceRecord>;
    timestamp?: string;
  } = {}
): { updatedPiece: MailPiece; error?: string } {
  const guard = canTransitionStatus(
    piece,
    targetStatus,
    options.userConfirmed ?? false,
    options.newEvidence
  );

  if (!guard.allowed) {
    return {
      updatedPiece: piece,
      error: guard.reason || `Transition to ${targetStatus} is guarded: ${guard.missingRequirements.join(', ')}`
    };
  }

  const now = options.timestamp || new Date().toISOString();
  let updatedEvidence = [...piece.evidence];
  let attachedEvidenceId: string | undefined;

  if (options.newEvidence) {
    const evVal = validateEvidenceRecord(options.newEvidence);
    if (evVal.isValid) {
      const createdRecord: EvidenceRecord = {
        id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: options.newEvidence.type || 'other',
        title: (options.newEvidence.title || '').trim(),
        source: (options.newEvidence.source || '').trim(),
        observedDate: (options.newEvidence.observedDate || '').trim(),
        reference: options.newEvidence.reference?.trim(),
        notes: options.newEvidence.notes?.trim(),
        createdAt: now
      };
      updatedEvidence.push(createdRecord);
      attachedEvidenceId = createdRecord.id;
    }
  }

  const historyEvent: LifecycleEvent = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    fromStatus: piece.status,
    toStatus: targetStatus,
    timestamp: now,
    notes: options.notes?.trim(),
    evidenceId: attachedEvidenceId
  };

  const updatedPiece: MailPiece = {
    ...piece,
    status: targetStatus,
    evidence: updatedEvidence,
    history: [...piece.history, historyEvent],
    updatedAt: now
  };

  return { updatedPiece };
}

// ---------------------------------------------------------------------------
// STORE CREATION, FACTORY & MUTATION HELPERS
// ---------------------------------------------------------------------------

export function createEmptyAddress(): USAddress {
  return {
    name: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: ''
  };
}

export function createEmptyStore(): CertifiedMailerStore {
  return {
    version: CERTIFIED_MAILER_STORE_VERSION,
    activePieceId: null,
    pieces: []
  };
}

export function createNewMailPiece(
  title?: string,
  template?: DisputeStarterTemplate | null
): MailPiece {
  const now = new Date().toISOString();
  const id = `mail_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  if (template) {
    return {
      id,
      title: title || `${template.name} (Draft)`,
      category: template.category,
      statutoryReference: template.statutoryReference,
      sender: createEmptyAddress(), // Senders start blank for user privacy and truthfulness
      recipient: {
        name: template.sampleRecipient.name || '',
        addressLine1: template.sampleRecipient.addressLine1 || '',
        addressLine2: template.sampleRecipient.addressLine2 || '',
        city: template.sampleRecipient.city || '',
        state: template.sampleRecipient.state || '',
        postalCode: template.sampleRecipient.postalCode || ''
      },
      subject: template.subject,
      body: template.bodyTemplate,
      trackingNumber: '',
      status: 'draft',
      history: [
        {
          id: `evt_${Date.now()}_init`,
          fromStatus: 'draft',
          toStatus: 'draft',
          timestamp: now,
          notes: `Created from sample starter template: ${template.name}`
        }
      ],
      evidence: [],
      notes: template.instructions,
      createdAt: now,
      updatedAt: now
    };
  }

  return {
    id,
    title: title || 'Untitled Certified Mail Piece',
    sender: createEmptyAddress(),
    recipient: createEmptyAddress(),
    subject: '',
    body: '',
    trackingNumber: '',
    status: 'draft',
    history: [
      {
        id: `evt_${Date.now()}_init`,
        fromStatus: 'draft',
        toStatus: 'draft',
        timestamp: now,
        notes: 'Created new mail piece draft'
      }
    ],
    evidence: [],
    createdAt: now,
    updatedAt: now
  };
}

// ---------------------------------------------------------------------------
// SANITIZATION & SECURITY BOUNDS
// ---------------------------------------------------------------------------

export function sanitizeText(input: unknown, maxLength = 20000): string {
  if (input === null || input === undefined) return '';
  const str = String(input);
  // Strip active HTML tags and script payloads, remove zero-width or non-printable chars
  const stripped = str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
    .replace(/javascript:/gi, '');
  return stripped.slice(0, maxLength);
}

export function sanitizeAddress(raw: any): USAddress {
  if (!raw || typeof raw !== 'object') return createEmptyAddress();
  return {
    name: sanitizeText(raw.name, 100).trim(),
    addressLine1: sanitizeText(raw.addressLine1, 120).trim(),
    addressLine2: raw.addressLine2 ? sanitizeText(raw.addressLine2, 120).trim() : '',
    city: sanitizeText(raw.city, 60).trim(),
    state: sanitizeText(raw.state, 10).trim().toUpperCase(),
    postalCode: sanitizeText(raw.postalCode, 20).trim()
  };
}

export function sanitizeEvidenceRecord(raw: any): EvidenceRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const validTypes: EvidenceType[] = [
    'acceptance_receipt',
    'tracking_event',
    'delivery_receipt',
    'return_notice',
    'other'
  ];
  // v0 used return_receipt for a return-to-sender notice. Preserve those local
  // records under the less ambiguous v1 name; PS Form 3811 belongs under
  // delivery_receipt.
  const migratedType = raw.type === 'return_receipt' ? 'return_notice' : raw.type;
  const type = validTypes.includes(migratedType) ? migratedType : 'other';
  const title = sanitizeText(raw.title, 120).trim();
  const source = sanitizeText(raw.source, 150).trim();
  const observedDate = sanitizeText(raw.observedDate, 20).trim();
  if (!title || !source || !observedDate) return null;

  return {
    id: sanitizeText(raw.id, 64) || `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    title,
    source,
    observedDate,
    reference: raw.reference ? sanitizeText(raw.reference, 100).trim() : undefined,
    notes: raw.notes ? sanitizeText(raw.notes, 2000).trim() : undefined,
    createdAt: sanitizeText(raw.createdAt, 40) || new Date().toISOString()
  };
}

export function sanitizeLifecycleEvent(raw: any): LifecycleEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const validStatuses: MailLifecycleStatus[] = [
    'draft',
    'ready_to_print',
    'mailed',
    'delivered',
    'returned',
    'closed'
  ];
  const fromStatus = validStatuses.includes(raw.fromStatus) ? raw.fromStatus : 'draft';
  const toStatus = validStatuses.includes(raw.toStatus) ? raw.toStatus : 'draft';

  return {
    id: sanitizeText(raw.id, 64) || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    fromStatus,
    toStatus,
    timestamp: sanitizeText(raw.timestamp, 40) || new Date().toISOString(),
    notes: raw.notes ? sanitizeText(raw.notes, 500).trim() : undefined,
    evidenceId: raw.evidenceId ? sanitizeText(raw.evidenceId, 64) : undefined
  };
}

export function sanitizeMailPiece(raw: any): MailPiece | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = sanitizeText(raw.id, 64) || `mail_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const title = sanitizeText(raw.title, 150).trim() || 'Untitled Mail Piece';

  const validStatuses: MailLifecycleStatus[] = [
    'draft',
    'ready_to_print',
    'mailed',
    'delivered',
    'returned',
    'closed'
  ];
  const status: MailLifecycleStatus = validStatuses.includes(raw.status) ? raw.status : 'draft';

  const evidence: EvidenceRecord[] = Array.isArray(raw.evidence)
    ? raw.evidence.map(sanitizeEvidenceRecord).filter((e: EvidenceRecord | null): e is EvidenceRecord => e !== null)
    : [];

  const history: LifecycleEvent[] = Array.isArray(raw.history)
    ? raw.history.map(sanitizeLifecycleEvent).filter((h: LifecycleEvent | null): h is LifecycleEvent => h !== null)
    : [
        {
          id: `evt_${Date.now()}_init`,
          fromStatus: status,
          toStatus: status,
          timestamp: new Date().toISOString(),
          notes: 'Imported or recovered record'
        }
      ];

  const now = new Date().toISOString();

  return {
    id,
    title,
    referenceNumber: raw.referenceNumber ? sanitizeText(raw.referenceNumber, 80).trim() : undefined,
    category: raw.category ? sanitizeText(raw.category, 60).trim() : undefined,
    statutoryReference: raw.statutoryReference ? sanitizeText(raw.statutoryReference, 120).trim() : undefined,
    sender: sanitizeAddress(raw.sender),
    recipient: sanitizeAddress(raw.recipient),
    subject: sanitizeText(raw.subject, 300).trim(),
    body: sanitizeText(raw.body, 20000).trim(),
    trackingNumber: raw.trackingNumber ? normalizeTrackingNumber(sanitizeText(raw.trackingNumber, 50)) : '',
    status,
    history,
    evidence,
    notes: raw.notes ? sanitizeText(raw.notes, 2000).trim() : undefined,
    createdAt: sanitizeText(raw.createdAt, 40) || now,
    updatedAt: sanitizeText(raw.updatedAt, 40) || now
  };
}

// ---------------------------------------------------------------------------
// LOCAL STORAGE PERSISTENCE & JSON IMPORT / EXPORT
// ---------------------------------------------------------------------------

export interface StorageLoadResult {
  store: CertifiedMailerStore;
  warning?: string;
}

export function loadStoreFromLocalStorage(
  key = CERTIFIED_MAILER_STORAGE_KEY,
  customStorage?: Storage
): StorageLoadResult {
  try {
    const storage = customStorage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!storage) {
      return { store: createEmptyStore() };
    }

    const rawData = storage.getItem(key);
    if (!rawData) {
      return { store: createEmptyStore() };
    }

    if (rawData.length > 5 * 1024 * 1024) {
      return {
        store: createEmptyStore(),
        warning: 'Saved Certified Mailer data exceeds the 5 MB safety limit. Export or remove it before retrying.'
      };
    }

    const parsed = JSON.parse(rawData);
    if (!parsed || typeof parsed !== 'object') {
      return {
        store: createEmptyStore(),
        warning: 'Corrupted localStorage data encountered. Initialized fresh store.'
      };
    }

    if (parsed.version !== undefined && parsed.version !== CERTIFIED_MAILER_STORE_VERSION) {
      return {
        store: createEmptyStore(),
        warning: `Unsupported Certified Mailer storage version "${String(parsed.version)}". The saved data was left untouched.`
      };
    }

    const pieces: MailPiece[] = Array.isArray(parsed.pieces)
      ? parsed.pieces.map(sanitizeMailPiece).filter((p: MailPiece | null): p is MailPiece => p !== null)
      : [];

    let activePieceId: string | null = parsed.activePieceId || null;
    if (activePieceId && !pieces.some(p => p.id === activePieceId)) {
      activePieceId = pieces.length > 0 ? pieces[0].id : null;
    }

    const store: CertifiedMailerStore = {
      version: CERTIFIED_MAILER_STORE_VERSION,
      activePieceId,
      pieces,
      lastExportedAt: parsed.lastExportedAt ? sanitizeText(parsed.lastExportedAt, 40) : undefined
    };

    return { store };
  } catch (err: any) {
    return {
      store: createEmptyStore(),
      warning: `Failed to load local storage data: ${err?.message || 'Unknown error'}. Started clean journal.`
    };
  }
}

export interface StorageSaveResult {
  success: boolean;
  error?: string;
}

export function saveStoreToLocalStorage(
  store: CertifiedMailerStore,
  key = CERTIFIED_MAILER_STORAGE_KEY,
  customStorage?: Storage
): StorageSaveResult {
  try {
    const storage = customStorage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!storage) {
      return {
        success: false,
        error: 'Browser localStorage is not available in this environment.'
      };
    }

    const serialized = JSON.stringify(store);
    storage.setItem(key, serialized);
    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: `Failed to save to localStorage (${err?.name || 'Error'}): ${err?.message || 'Storage write failed'}`
    };
  }
}

export function serializeStoreToJson(store: CertifiedMailerStore): string {
  return JSON.stringify(store, null, 2);
}

export interface ImportJsonResult {
  success: boolean;
  store?: CertifiedMailerStore;
  importedCount: number;
  error?: string;
}

function hasOnlyBoundedString(value: unknown, maxLength: number, optional = false): boolean {
  if (value === undefined || value === null) return optional;
  return typeof value === 'string' && value.length <= maxLength;
}

function isImportableAddress(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const address = raw as Record<string, unknown>;
  return (
    hasOnlyBoundedString(address.name, 100) &&
    hasOnlyBoundedString(address.addressLine1, 120) &&
    hasOnlyBoundedString(address.addressLine2, 120, true) &&
    hasOnlyBoundedString(address.city, 60) &&
    hasOnlyBoundedString(address.state, 10) &&
    hasOnlyBoundedString(address.postalCode, 20)
  );
}

function isImportableEvidence(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const evidence = raw as Record<string, unknown>;
  const validTypes = [
    'acceptance_receipt', 'tracking_event', 'delivery_receipt', 'return_notice',
    // Accepted only as a migration alias from the pre-v1 prototype.
    'return_receipt', 'other'
  ];
  return (
    typeof evidence.type === 'string' && validTypes.includes(evidence.type) &&
    hasOnlyBoundedString(evidence.id, 64, true) &&
    hasOnlyBoundedString(evidence.title, 120) &&
    hasOnlyBoundedString(evidence.source, 150) &&
    hasOnlyBoundedString(evidence.observedDate, 20) &&
    hasOnlyBoundedString(evidence.reference, 100, true) &&
    hasOnlyBoundedString(evidence.notes, 2000, true) &&
    hasOnlyBoundedString(evidence.createdAt, 40, true) &&
    validateEvidenceRecord(evidence as Partial<EvidenceRecord>).isValid
  );
}

function isImportableHistoryEvent(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const event = raw as Record<string, unknown>;
  const validStatuses: MailLifecycleStatus[] = [
    'draft', 'ready_to_print', 'mailed', 'delivered', 'returned', 'closed'
  ];
  return (
    hasOnlyBoundedString(event.id, 64, true) &&
    typeof event.fromStatus === 'string' && validStatuses.includes(event.fromStatus as MailLifecycleStatus) &&
    typeof event.toStatus === 'string' && validStatuses.includes(event.toStatus as MailLifecycleStatus) &&
    hasOnlyBoundedString(event.timestamp, 40) &&
    hasOnlyBoundedString(event.notes, 500, true) &&
    hasOnlyBoundedString(event.evidenceId, 64, true)
  );
}

function isImportableMailPiece(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const piece = raw as Record<string, unknown>;
  const validStatuses: MailLifecycleStatus[] = [
    'draft', 'ready_to_print', 'mailed', 'delivered', 'returned', 'closed'
  ];
  if (
    !hasOnlyBoundedString(piece.id, 64, true) ||
    !hasOnlyBoundedString(piece.title, 150) ||
    !hasOnlyBoundedString(piece.subject, 300) ||
    !hasOnlyBoundedString(piece.body, 20000) ||
    !hasOnlyBoundedString(piece.trackingNumber, 50, true) ||
    !isImportableAddress(piece.sender) ||
    !isImportableAddress(piece.recipient) ||
    (piece.status !== undefined && !validStatuses.includes(piece.status as MailLifecycleStatus)) ||
    (piece.evidence !== undefined && (!Array.isArray(piece.evidence) || piece.evidence.length > 500)) ||
    (piece.history !== undefined && (!Array.isArray(piece.history) || piece.history.length > 1000)) ||
    (Array.isArray(piece.evidence) && piece.evidence.some(item => !isImportableEvidence(item))) ||
    (Array.isArray(piece.history) && piece.history.some(item => !isImportableHistoryEvent(item)))
  ) {
    return false;
  }
  return true;
}

export function importStoreFromJson(jsonText: string): ImportJsonResult {
  if (!jsonText || typeof jsonText !== 'string') {
    return {
      success: false,
      importedCount: 0,
      error: 'Import payload must be a non-empty string.'
    };
  }

  if (jsonText.length > 5 * 1024 * 1024) {
    return {
      success: false,
      importedCount: 0,
      error: 'Import payload exceeds maximum allowed size (5 MB).'
    };
  }

  try {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object') {
      return {
        success: false,
        importedCount: 0,
        error: 'Import file does not contain valid JSON object structure.'
      };
    }

    if (
      !Array.isArray(parsed) &&
      'version' in parsed &&
      parsed.version !== CERTIFIED_MAILER_STORE_VERSION
    ) {
      return {
        success: false,
        importedCount: 0,
        error: `Unsupported Certified Mailer backup version "${String(parsed.version)}".`
      };
    }

    // Support either full CertifiedMailerStore or a single MailPiece object
    let rawPieces: any[] = [];
    if (Array.isArray(parsed.pieces)) {
      rawPieces = parsed.pieces;
    } else if (parsed.sender && parsed.recipient && (parsed.subject !== undefined || parsed.body !== undefined)) {
      rawPieces = [parsed];
    } else if (Array.isArray(parsed)) {
      rawPieces = parsed;
    } else {
      return {
        success: false,
        importedCount: 0,
        error: 'JSON structure does not match a valid Certified Mailer backup or mail piece schema.'
      };
    }


    if (rawPieces.length > 500) {
      return {
        success: false,
        importedCount: 0,
        error: 'Import contains more than the maximum 500 mail pieces.'
      };
    }

    const rejectedCount = rawPieces.filter(piece => !isImportableMailPiece(piece)).length;
    if (rejectedCount > 0) {
      return {
        success: false,
        importedCount: 0,
        error: `Import rejected: ${rejectedCount} mail piece(s) have an unsupported or unsafe schema.`
      };
    }

    const sanitizedPieces = rawPieces
      .map(sanitizeMailPiece)
      .filter((p: MailPiece | null): p is MailPiece => p !== null);

    if (sanitizedPieces.length === 0) {
      return {
        success: false,
        importedCount: 0,
        error: 'No valid mail pieces found in import file.'
      };
    }


    const ids = new Set<string>();
    if (sanitizedPieces.some(piece => ids.has(piece.id) || !ids.add(piece.id))) {
      return {
        success: false,
        importedCount: 0,
        error: 'Import rejected because mail piece IDs are duplicated.'
      };
    }

    const importedStore: CertifiedMailerStore = {
      version: CERTIFIED_MAILER_STORE_VERSION,
      activePieceId: sanitizedPieces[0].id,
      pieces: sanitizedPieces,
      lastExportedAt: new Date().toISOString()
    };

    return {
      success: true,
      store: importedStore,
      importedCount: sanitizedPieces.length
    };
  } catch (err: any) {
    return {
      success: false,
      importedCount: 0,
      error: `JSON parsing error: ${err?.message || 'Malformed JSON'}`
    };
  }
}

// ---------------------------------------------------------------------------
// NOTICE TEXT GENERATOR & ADDRESS FORMATTERS
// ---------------------------------------------------------------------------

export function formatAddressMultiLine(address: USAddress): string {
  const lines: string[] = [];
  if (address.name) lines.push(address.name);
  if (address.addressLine1) lines.push(address.addressLine1);
  if (address.addressLine2) lines.push(address.addressLine2);
  const cityStateZip = [
    address.city,
    address.state ? `${address.state} ${address.postalCode}`.trim() : address.postalCode
  ]
    .filter(Boolean)
    .join(', ');
  if (cityStateZip) lines.push(cityStateZip);
  return lines.join('\n');
}

export function formatAddressSingleLine(address: USAddress): string {
  const parts: string[] = [];
  if (address.name) parts.push(address.name);
  if (address.addressLine1) parts.push(address.addressLine1);
  if (address.addressLine2) parts.push(address.addressLine2);
  if (address.city) parts.push(address.city);
  if (address.state || address.postalCode) {
    parts.push(`${address.state} ${address.postalCode}`.trim());
  }
  return parts.filter(Boolean).join(', ');
}

export function generateNoticePlainText(piece: MailPiece): string {
  const trackingFormatted = piece.trackingNumber
    ? formatTrackingNumberForDisplay(piece.trackingNumber)
    : 'Not Specified (Unverified)';

  const senderBlock = formatAddressMultiLine(piece.sender) || '[Sender Name & Address]';
  const recipientBlock = formatAddressMultiLine(piece.recipient) || '[Recipient Name & Address]';
  const dateStr = new Date(piece.updatedAt || piece.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const lines = [
    '======================================================================',
    'USPS CERTIFIED MAIL® PREPARATION & JOURNAL NOTICE',
    '======================================================================',
    `ARTICLE NUMBER (USER-ENTERED): ${trackingFormatted}`,
    `STATUS: ${piece.status.toUpperCase()}`,
    `DATE: ${dateStr}`,
    piece.referenceNumber ? `REF / ACCOUNT #: ${piece.referenceNumber}` : '',
    piece.statutoryReference ? `STATUTORY BASIS: ${piece.statutoryReference}` : '',
    '----------------------------------------------------------------------',
    'FROM (SENDER):',
    senderBlock,
    '',
    'TO (DELIVER VIA CERTIFIED MAIL TO):',
    recipientBlock,
    '----------------------------------------------------------------------',
    `SUBJECT: ${piece.subject || '[Subject]'}`,
    '----------------------------------------------------------------------',
    '',
    'To Whom It May Concern:',
    '',
    piece.body || '[Letter body content]',
    '',
    'Sincerely,',
    '',
    piece.sender.name || '[Sender Name]',
    '',
    '======================================================================',
    'EVIDENCE JOURNAL & LIFECYCLE SUMMARY',
    '======================================================================',
    `Current Lifecycle Status: ${piece.status}`,
    `Evidence Records Logged: ${piece.evidence.length}`,
    ...piece.evidence.map(
      (ev, idx) =>
        `  ${idx + 1}. [${ev.type.toUpperCase()}] ${ev.title} (Observed: ${ev.observedDate}, Source: ${ev.source}${ev.reference ? `, Ref: ${ev.reference}` : ''})`
    ),
    '----------------------------------------------------------------------',
    'DISCLAIMER: This notice was prepared with Certified Mailer, an offline',
    'client-side recordkeeping journal. This software is not affiliated with',
    'or endorsed by the USPS and does not constitute formal legal advice.',
    'Official postage, PS Form 3800, and PS Form 3811 must be purchased from USPS.',
    '======================================================================'
  ];

  return lines.filter(line => line !== null).join('\n');
}
