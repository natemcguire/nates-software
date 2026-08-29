import { describe, it, expect, beforeEach } from 'vitest';
import {
  US_STATE_CODES,
  US_STATES,
  USAddress,
  MailPiece,
  EvidenceRecord,
  CertifiedMailerStore,
  CERTIFIED_MAILER_STORAGE_KEY,
  STARTER_TEMPLATES,
  validateUSAddress,
  normalizeTrackingNumber,
  formatTrackingNumberForDisplay,
  validateTrackingNumber,
  validateMailPiece,
  validateEvidenceRecord,
  canTransitionStatus,
  transitionMailPieceStatus,
  createEmptyAddress,
  createEmptyStore,
  createNewMailPiece,
  sanitizeText,
  sanitizeAddress,
  sanitizeEvidenceRecord,
  sanitizeLifecycleEvent,
  sanitizeMailPiece,
  loadStoreFromLocalStorage,
  saveStoreToLocalStorage,
  serializeStoreToJson,
  importStoreFromJson,
  formatAddressMultiLine,
  formatAddressSingleLine,
  generateNoticePlainText
} from '../src/lib/certifiedMailerDomain';

describe('Certified Mailer Domain - Address Validation', () => {
  it('validates a complete standard US address', () => {
    const addr: USAddress = {
      name: 'Acme Property Management LLC',
      addressLine1: '100 Congress Ave',
      addressLine2: 'Suite 400',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701'
    };

    const res = validateUSAddress(addr);
    expect(res.isValid).toBe(true);
    expect(Object.keys(res.errors)).toHaveLength(0);
  });

  it('validates a 9-digit ZIP+4 code format', () => {
    const addr1: USAddress = {
      name: 'Equifax Information Services LLC',
      addressLine1: 'P.O. Box 740256',
      city: 'Atlanta',
      state: 'GA',
      postalCode: '30374-0256'
    };
    const res1 = validateUSAddress(addr1);
    expect(res1.isValid).toBe(true);

    const addr2: USAddress = {
      name: 'Equifax Information Services LLC',
      addressLine1: 'P.O. Box 740256',
      city: 'Atlanta',
      state: 'GA',
      postalCode: '303740256'
    };
    const res2 = validateUSAddress(addr2);
    expect(res2.isValid).toBe(true);
  });

  it('flags missing required fields', () => {
    const res = validateUSAddress({
      name: '',
      addressLine1: '',
      city: '',
      state: '',
      postalCode: ''
    });

    expect(res.isValid).toBe(false);
    expect(res.errors.name).toBeDefined();
    expect(res.errors.addressLine1).toBeDefined();
    expect(res.errors.city).toBeDefined();
    expect(res.errors.state).toBeDefined();
    expect(res.errors.postalCode).toBeDefined();
  });

  it('flags invalid 2-letter state abbreviations', () => {
    const res = validateUSAddress({
      name: 'John Doe',
      addressLine1: '123 Main St',
      city: 'Austin',
      state: 'XX',
      postalCode: '78704'
    });

    expect(res.isValid).toBe(false);
    expect(res.errors.state).toContain('valid 2-letter US state');
  });

  it('flags invalid postal codes', () => {
    const res1 = validateUSAddress({
      name: 'John Doe',
      addressLine1: '123 Main St',
      city: 'Austin',
      state: 'TX',
      postalCode: '1234' // Too short
    });
    expect(res1.isValid).toBe(false);
    expect(res1.errors.postalCode).toBeDefined();

    const res2 = validateUSAddress({
      name: 'John Doe',
      addressLine1: '123 Main St',
      city: 'Austin',
      state: 'TX',
      postalCode: 'ABCDE' // Non-numeric
    });
    expect(res2.isValid).toBe(false);
    expect(res2.errors.postalCode).toBeDefined();
  });

  it('supports all 50 US states plus DC, PR, VI, GU, AS, MP', () => {
    expect(US_STATE_CODES).toContain('TX');
    expect(US_STATE_CODES).toContain('CA');
    expect(US_STATE_CODES).toContain('NY');
    expect(US_STATE_CODES).toContain('DC');
    expect(US_STATE_CODES).toContain('PR');
    expect(US_STATES.length).toBeGreaterThanOrEqual(55);
  });
});

describe('Certified Mailer Domain - Tracking Number Validation & Normalization', () => {
  it('exposes the standard storage key constant', () => {
    expect(CERTIFIED_MAILER_STORAGE_KEY).toBe('nates_certified_mailer_v1');
  });

  it('normalizes and formats tracking numbers directly', () => {
    expect(normalizeTrackingNumber(' 9407-1118-9956 ')).toBe('940711189956');
    expect(normalizeTrackingNumber(null)).toBe('');
    expect(formatTrackingNumberForDisplay('9407111899562210440122')).toBe('9407 1118 9956 2210 4401 22');
    expect(formatTrackingNumberForDisplay('')).toBe('');
  });

  it('sanitizes lifecycle event objects with fallback defaults', () => {
    const evt = sanitizeLifecycleEvent({
      fromStatus: 'invalid_status' as any,
      toStatus: 'mailed',
      notes: '<script>alert(1)</script>Mailed at counter'
    });
    expect(evt).not.toBeNull();
    expect(evt?.fromStatus).toBe('draft');
    expect(evt?.toStatus).toBe('mailed');
    expect(evt?.notes).not.toContain('<script');
    expect(evt?.notes).toBe('Mailed at counter');
  });

  it('accepts empty/blank tracking numbers as optional (unverified)', () => {
    const res1 = validateTrackingNumber('');
    expect(res1.isValid).toBe(true);
    expect(res1.isProvided).toBe(false);

    const res2 = validateTrackingNumber(null);
    expect(res2.isValid).toBe(true);
    expect(res2.isProvided).toBe(false);

    const res3 = validateTrackingNumber('   ');
    expect(res3.isValid).toBe(true);
    expect(res3.isProvided).toBe(false);
  });

  it('normalizes and validates standard 20-digit and 22-digit USPS tracking numbers', () => {
    // 22-digit USPS Certified Mail barcode format
    const raw22 = '9407 1118 9956 2210 4401 22';
    const res22 = validateTrackingNumber(raw22);
    expect(res22.isValid).toBe(true);
    expect(res22.normalized).toBe('9407111899562210440122');
    expect(res22.formatted).toBe('9407 1118 9956 2210 4401 22');

    // 20-digit USPS article number (e.g. 7020 0640 0001 2345 6789)
    const raw20 = '7020-0640-0001-2345-6789';
    const res20 = validateTrackingNumber(raw20);
    expect(res20.isValid).toBe(true);
    expect(res20.normalized).toBe('70200640000123456789');
  });

  it('validates 13-character S10 international tracking format', () => {
    const rawS10 = 'EA 123 456 789 US';
    const resS10 = validateTrackingNumber(rawS10);
    expect(resS10.isValid).toBe(true);
    expect(resS10.normalized).toBe('EA123456789US');
  });

  it('flags invalid or unplausible tracking numbers', () => {
    const bad1 = validateTrackingNumber('12345'); // too short
    expect(bad1.isValid).toBe(false);
    expect(bad1.error).toBeDefined();

    const bad2 = validateTrackingNumber('94071118995622104401229999'); // too long (26 digits)
    expect(bad2.isValid).toBe(false);
    expect(bad2.error).toBeDefined();

    const bad3 = validateTrackingNumber('NOT-A-REAL-BARCODE-STRING');
    expect(bad3.isValid).toBe(false);
  });

  it('rejects unresolved starter placeholders before a piece is ready', () => {
    const piece = createNewMailPiece(undefined, STARTER_TEMPLATES[0]);
    piece.sender = {
      name: 'Sender', addressLine1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701'
    };
    expect(validateMailPiece(piece).errors.placeholders).toContain('Replace every bracketed');
    expect(canTransitionStatus(piece, 'ready_to_print').allowed).toBe(false);
  });
});

describe('Certified Mailer Domain - Document Validation', () => {
  it('validates a complete mail piece', () => {
    const piece: Partial<MailPiece> = {
      title: 'Security Deposit Demand Notice',
      sender: {
        name: 'Jane Doe',
        addressLine1: '123 Main St',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704'
      },
      recipient: {
        name: 'Landlord Co',
        addressLine1: '404 West 7th St',
        city: 'Austin',
        state: 'TX',
        postalCode: '78701'
      },
      subject: 'Security Deposit Demand - Lease #404',
      body: 'Formal demand for return of $2,400 deposit.'
    };

    const res = validateMailPiece(piece);
    expect(res.isValid).toBe(true);
    expect(Object.keys(res.errors)).toHaveLength(0);
  });

  it('catches missing subject or empty body', () => {
    const piece: Partial<MailPiece> = {
      title: 'Test Piece',
      sender: {
        name: 'Jane Doe',
        addressLine1: '123 Main St',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704'
      },
      recipient: {
        name: 'Landlord Co',
        addressLine1: '404 West 7th St',
        city: 'Austin',
        state: 'TX',
        postalCode: '78701'
      },
      subject: '',
      body: ''
    };

    const res = validateMailPiece(piece);
    expect(res.isValid).toBe(false);
    expect(res.errors.subject).toBeDefined();
    expect(res.errors.body).toBeDefined();
  });
});

describe('Certified Mailer Domain - Lifecycle Transitions & Guards', () => {
  let sampleValidPiece: MailPiece;

  beforeEach(() => {
    sampleValidPiece = {
      id: 'mail_test_1',
      title: 'Security Deposit Return',
      sender: {
        name: 'Tenant User',
        addressLine1: '100 First St',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704'
      },
      recipient: {
        name: 'Landlord LLC',
        addressLine1: '200 Second St',
        city: 'Austin',
        state: 'TX',
        postalCode: '78701'
      },
      subject: 'Demand for Deposit Return',
      body: 'Please remit $2,000 within 10 days.',
      trackingNumber: '9407111899562210440122',
      status: 'draft',
      history: [],
      evidence: [],
      createdAt: '2026-08-29T10:00:00Z',
      updatedAt: '2026-08-29T10:00:00Z'
    };
  });

  it('allows transition from draft to ready_to_print when fields are valid', () => {
    const guard = canTransitionStatus(sampleValidPiece, 'ready_to_print');
    expect(guard.allowed).toBe(true);

    const transitionRes = transitionMailPieceStatus(sampleValidPiece, 'ready_to_print');
    expect(transitionRes.error).toBeUndefined();
    expect(transitionRes.updatedPiece.status).toBe('ready_to_print');
    expect(transitionRes.updatedPiece.history).toHaveLength(1);
    expect(transitionRes.updatedPiece.history[0].toStatus).toBe('ready_to_print');
  });

  it('blocks draft -> ready_to_print if sender address is incomplete', () => {
    const incompletePiece: MailPiece = {
      ...sampleValidPiece,
      sender: createEmptyAddress()
    };

    const guard = canTransitionStatus(incompletePiece, 'ready_to_print');
    expect(guard.allowed).toBe(false);
    expect(guard.missingRequirements).toContain('Complete valid sender mailing address');

    const result = transitionMailPieceStatus(incompletePiece, 'ready_to_print');
    expect(result.error).toBeDefined();
    expect(result.updatedPiece.status).toBe('draft');
  });

  it('allows ready_to_print -> draft to permit further editing', () => {
    const readyPiece: MailPiece = {
      ...sampleValidPiece,
      status: 'ready_to_print'
    };

    const guard = canTransitionStatus(readyPiece, 'draft');
    expect(guard.allowed).toBe(true);

    const res = transitionMailPieceStatus(readyPiece, 'draft');
    expect(res.updatedPiece.status).toBe('draft');
  });

  it('never marks mailed without user confirmation and required user-entered evidence', () => {
    const readyPiece: MailPiece = {
      ...sampleValidPiece,
      status: 'ready_to_print'
    };

    // 1. Without user confirmation
    const guard1 = canTransitionStatus(readyPiece, 'mailed', false);
    expect(guard1.allowed).toBe(false);
    expect(guard1.missingRequirements).toContain(
      'Explicit user confirmation of postal deposit / mailing'
    );

    // 2. Confirmed, but no acceptance evidence record
    const guard2 = canTransitionStatus(readyPiece, 'mailed', true);
    expect(guard2.allowed).toBe(false);
    expect(guard2.missingRequirements.some(r => r.includes('mailing evidence'))).toBe(true);

    // 3. Confirmed with valid pending acceptance evidence
    const pendingEvidence: Partial<EvidenceRecord> = {
      type: 'acceptance_receipt',
      title: 'USPS Counter Postmark Receipt PS 3800',
      source: 'Austin Downtown Post Office Counter #2',
      observedDate: '2026-08-29',
      reference: '9407111899562210440122'
    };

    const guard3 = canTransitionStatus(readyPiece, 'mailed', true, pendingEvidence);
    expect(guard3.allowed).toBe(true);

    const res = transitionMailPieceStatus(readyPiece, 'mailed', {
      userConfirmed: true,
      newEvidence: pendingEvidence,
      notes: 'Deposited at retail counter'
    });

    expect(res.error).toBeUndefined();
    expect(res.updatedPiece.status).toBe('mailed');
    expect(res.updatedPiece.evidence).toHaveLength(1);
    expect(res.updatedPiece.evidence[0].type).toBe('acceptance_receipt');
    expect(res.updatedPiece.history).toHaveLength(1);
    expect(res.updatedPiece.history[0].toStatus).toBe('mailed');
  });

  it('does not skip review by moving directly from draft to mailed', () => {
    const evidence: Partial<EvidenceRecord> = {
      type: 'acceptance_receipt',
      title: 'Counter receipt',
      source: 'Post Office counter',
      observedDate: '2026-08-29'
    };
    expect(canTransitionStatus(sampleValidPiece, 'mailed', true, evidence).allowed).toBe(false);
  });

  it('never marks delivered without user confirmation and delivery evidence', () => {
    const mailedPiece: MailPiece = {
      ...sampleValidPiece,
      status: 'mailed',
      evidence: [
        {
          id: 'ev_acc_1',
          type: 'acceptance_receipt',
          title: 'Acceptance Stamp',
          source: 'Post Office Counter',
          observedDate: '2026-08-29',
          createdAt: '2026-08-29T10:00:00Z'
        }
      ]
    };

    // 1. Without confirmation
    const guard1 = canTransitionStatus(mailedPiece, 'delivered', false);
    expect(guard1.allowed).toBe(false);

    // 2. Without delivery evidence
    const guard2 = canTransitionStatus(mailedPiece, 'delivered', true);
    expect(guard2.allowed).toBe(false);
    expect(guard2.missingRequirements.some(r => r.includes('delivery observation'))).toBe(true);

    // 3. With valid delivery receipt evidence
    const deliveryEvidence: Partial<EvidenceRecord> = {
      type: 'delivery_receipt',
      title: 'PS Form 3811 Green Card Return Receipt Signed',
      source: 'Physical Mail Delivery',
      observedDate: '2026-09-02',
      notes: 'Signed by recipient agent'
    };

    const guard3 = canTransitionStatus(mailedPiece, 'delivered', true, deliveryEvidence);
    expect(guard3.allowed).toBe(true);

    const res = transitionMailPieceStatus(mailedPiece, 'delivered', {
      userConfirmed: true,
      newEvidence: deliveryEvidence
    });

    expect(res.error).toBeUndefined();
    expect(res.updatedPiece.status).toBe('delivered');
    expect(res.updatedPiece.evidence).toHaveLength(2);
  });

  it('never marks returned without user confirmation and return evidence', () => {
    const mailedPiece: MailPiece = {
      ...sampleValidPiece,
      status: 'mailed',
      evidence: [
        {
          id: 'ev_acc_1',
          type: 'acceptance_receipt',
          title: 'Acceptance Stamp',
          source: 'Post Office Counter',
          observedDate: '2026-08-29',
          createdAt: '2026-08-29T10:00:00Z'
        }
      ]
    };

    const returnEvidence: Partial<EvidenceRecord> = {
      type: 'return_notice',
      title: 'USPS Return to Sender Stamp - Vacant',
      source: 'Physical Envelope Return',
      observedDate: '2026-09-05',
      notes: 'Marked Return to Sender Unable to Forward'
    };

    const guard = canTransitionStatus(mailedPiece, 'returned', true, returnEvidence);
    expect(guard.allowed).toBe(true);

    const res = transitionMailPieceStatus(mailedPiece, 'returned', {
      userConfirmed: true,
      newEvidence: returnEvidence
    });

    expect(res.updatedPiece.status).toBe('returned');
  });

  it('forbids invalid out-of-order transitions', () => {
    // Draft directly to Delivered is strictly forbidden
    const guardDraftToDelivered = canTransitionStatus(sampleValidPiece, 'delivered', true);
    expect(guardDraftToDelivered.allowed).toBe(false);

    // Delivered back to Ready to Print is invalid
    const deliveredPiece: MailPiece = {
      ...sampleValidPiece,
      status: 'delivered'
    };
    const guardDeliveredToPrint = canTransitionStatus(deliveredPiece, 'ready_to_print');
    expect(guardDeliveredToPrint.allowed).toBe(false);
  });
});

describe('Certified Mailer Domain - Evidence Record Validation', () => {
  it('validates a correct evidence record', () => {
    const record: Partial<EvidenceRecord> = {
      type: 'acceptance_receipt',
      title: 'PS Form 3800 Receipt',
      source: 'USPS Retail Counter',
      observedDate: '2026-08-29',
      reference: '9407111899562210440122'
    };

    const res = validateEvidenceRecord(record);
    expect(res.isValid).toBe(true);
  });

  it('rejects evidence record with missing source or invalid date', () => {
    const res = validateEvidenceRecord({
      type: 'acceptance_receipt',
      title: 'PS 3800',
      source: '',
      observedDate: 'invalid-date'
    });

    expect(res.isValid).toBe(false);
    expect(res.errors.source).toBeDefined();
    expect(res.errors.observedDate).toBeDefined();
  });

  it('rejects calendar dates that merely roll over in JavaScript', () => {
    const res = validateEvidenceRecord({
      type: 'tracking_event',
      title: 'Observed event',
      source: 'User viewed carrier site',
      observedDate: '2026-02-30'
    });
    expect(res.isValid).toBe(false);
    expect(res.errors.observedDate).toContain('invalid');
  });
});

describe('Certified Mailer Domain - First-Run & Starter Templates', () => {
  it('creates a truthful blank first-run empty store', () => {
    const store = createEmptyStore();
    expect(store.version).toBe(1);
    expect(store.activePieceId).toBeNull();
    expect(store.pieces).toHaveLength(0);
  });

  it('creates a clean new blank mail piece without hardcoded sample identities', () => {
    const piece = createNewMailPiece();
    expect(piece.status).toBe('draft');
    expect(piece.sender.name).toBe('');
    expect(piece.sender.addressLine1).toBe('');
    expect(piece.recipient.name).toBe('');
    expect(piece.trackingNumber).toBe('');
    expect(piece.evidence).toHaveLength(0);
    expect(piece.history).toHaveLength(1);
  });

  it('starter templates have clear sample guidance and blank sender fields', () => {
    expect(STARTER_TEMPLATES.length).toBeGreaterThanOrEqual(4);

    for (const tmpl of STARTER_TEMPLATES) {
      expect(tmpl.name).toBeDefined();
      expect(tmpl.category).toBeDefined();
      expect(tmpl.instructions).toBeDefined();

      const piece = createNewMailPiece(undefined, tmpl);
      // Sender must remain completely blank so user enters their own truthful data
      expect(piece.sender.name).toBe('');
      expect(piece.sender.addressLine1).toBe('');
      expect(piece.category).toBe(tmpl.category);
      expect(piece.body).toContain('['); // Contains explicit bracketed placeholders
    }
  });
});

describe('Certified Mailer Domain - Sanitization, Import & Export Security', () => {
  it('sanitizes text by stripping active scripts and iframe tags', () => {
    const malicious = 'Hello <script>alert("xss")</script><iframe src="javascript:alert(1)"></iframe> world';
    const cleaned = sanitizeText(malicious);
    expect(cleaned).not.toContain('<script');
    expect(cleaned).not.toContain('<iframe');
    expect(cleaned).toContain('Hello');
    expect(cleaned).toContain('world');
  });

  it('serializes store to clean JSON and imports accurately', () => {
    const store: CertifiedMailerStore = {
      version: 1,
      activePieceId: 'mail_1',
      pieces: [
        {
          id: 'mail_1',
          title: 'Export Test Mail',
          sender: {
            name: 'Sender One',
            addressLine1: '123 Oak St',
            city: 'Austin',
            state: 'TX',
            postalCode: '78704'
          },
          recipient: {
            name: 'Recipient Two',
            addressLine1: '456 Pine St',
            city: 'Dallas',
            state: 'TX',
            postalCode: '75001'
          },
          subject: 'Formal Demand',
          body: 'Content of notice.',
          status: 'draft',
          history: [],
          evidence: [],
          createdAt: '2026-08-29T12:00:00Z',
          updatedAt: '2026-08-29T12:00:00Z'
        }
      ]
    };

    const json = serializeStoreToJson(store);
    expect(json).toContain('Export Test Mail');

    const importRes = importStoreFromJson(json);
    expect(importRes.success).toBe(true);
    expect(importRes.importedCount).toBe(1);
    expect(importRes.store?.pieces[0].title).toBe('Export Test Mail');
  });

  it('rejects oversized JSON payloads (> 5MB)', () => {
    const hugeStr = 'a'.repeat(6 * 1024 * 1024);
    const res = importStoreFromJson(hugeStr);
    expect(res.success).toBe(false);
    expect(res.error).toContain('exceeds maximum allowed size');
  });

  it('rejects invalid or non-JSON payloads gracefully', () => {
    const res1 = importStoreFromJson('');
    expect(res1.success).toBe(false);

    const res2 = importStoreFromJson('{ bad-json: true ');
    expect(res2.success).toBe(false);
    expect(res2.error).toContain('JSON');
  });

  it('rejects unsupported versions and invalid nested records instead of silently repairing them', () => {
    const future = importStoreFromJson(JSON.stringify({ version: 99, pieces: [] }));
    expect(future.success).toBe(false);
    expect(future.error).toContain('Unsupported');

    const invalidNested = importStoreFromJson(JSON.stringify({
      version: 1,
      pieces: [{
        id: 'mail_1', title: 'Imported', subject: 'Subject', body: 'Body', status: 'mailed',
        sender: { name: 'A', addressLine1: '1 Main', city: 'Austin', state: 'TX', postalCode: '78701' },
        recipient: { name: 'B', addressLine1: '2 Main', city: 'Austin', state: 'TX', postalCode: '78702' },
        evidence: [{ type: 'made_up', title: 'x', source: 'x', observedDate: '2026-08-29' }],
        history: []
      }]
    }));
    expect(invalidNested.success).toBe(false);
    expect(invalidNested.error).toContain('unsupported or unsafe schema');
  });
});

describe('Certified Mailer Domain - LocalStorage Loading & Corrupted Data Recovery', () => {
  class MockStorage implements Storage {
    private store: Record<string, string> = {};
    get length() {
      return Object.keys(this.store).length;
    }
    clear(): void {
      this.store = {};
    }
    getItem(key: string): string | null {
      return this.store[key] || null;
    }
    key(index: number): string | null {
      return Object.keys(this.store)[index] || null;
    }
    removeItem(key: string): void {
      delete this.store[key];
    }
    setItem(key: string, value: string): void {
      this.store[key] = value;
    }
  }

  it('loads clean store when localStorage is empty', () => {
    const mockStorage = new MockStorage();
    const { store, warning } = loadStoreFromLocalStorage('test_key', mockStorage);
    expect(store.pieces).toHaveLength(0);
    expect(store.version).toBe(1);
    expect(warning).toBeUndefined();
  });

  it('recovers gracefully with clean store when localStorage contains corrupted JSON', () => {
    const mockStorage = new MockStorage();
    mockStorage.setItem('test_key', '{"malformed": true, broken');

    const { store, warning } = loadStoreFromLocalStorage('test_key', mockStorage);
    expect(store.pieces).toHaveLength(0);
    expect(warning).toBeDefined();
  });

  it('saves and reloads store to localStorage properly', () => {
    const mockStorage = new MockStorage();
    const initialStore = createEmptyStore();
    const piece = createNewMailPiece('Tenant Letter');
    initialStore.pieces.push(piece);
    initialStore.activePieceId = piece.id;

    const saveRes = saveStoreToLocalStorage(initialStore, 'test_key', mockStorage);
    expect(saveRes.success).toBe(true);

    const { store } = loadStoreFromLocalStorage('test_key', mockStorage);
    expect(store.pieces).toHaveLength(1);
    expect(store.pieces[0].title).toBe('Tenant Letter');
    expect(store.activePieceId).toBe(piece.id);
  });
});

describe('Certified Mailer Domain - Notice Text Generation & Formatters', () => {
  it('formats multi-line and single-line addresses correctly', () => {
    const addr: USAddress = {
      name: 'Jane Doe',
      addressLine1: '123 Main St',
      addressLine2: 'Apt 4B',
      city: 'Austin',
      state: 'TX',
      postalCode: '78704'
    };

    const multi = formatAddressMultiLine(addr);
    expect(multi).toBe('Jane Doe\n123 Main St\nApt 4B\nAustin, TX 78704');

    const single = formatAddressSingleLine(addr);
    expect(single).toBe('Jane Doe, 123 Main St, Apt 4B, Austin, TX 78704');
  });

  it('generates clean plain text notice with explicit disclaimers and unverified tracking disclosure', () => {
    const piece: MailPiece = {
      id: 'mail_1',
      title: 'Security Deposit Demand',
      referenceNumber: 'LEASE-2026-88',
      statutoryReference: 'Tex. Prop. Code § 92.103',
      sender: {
        name: 'Jane Doe',
        addressLine1: '123 Main St',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704'
      },
      recipient: {
        name: 'Acme Landlord LLC',
        addressLine1: '400 Congress Ave',
        city: 'Austin',
        state: 'TX',
        postalCode: '78701'
      },
      subject: 'Security Deposit Refund Demand',
      body: 'I am formally demanding full return of my deposit in the amount of $2,000.',
      trackingNumber: '9407111899562210440122',
      status: 'mailed',
      history: [],
      evidence: [
        {
          id: 'ev_1',
          type: 'acceptance_receipt',
          title: 'PS 3800 Acceptance Postmark',
          source: 'Post Office Counter',
          observedDate: '2026-08-29',
          createdAt: '2026-08-29T12:00:00Z'
        }
      ],
      createdAt: '2026-08-29T12:00:00Z',
      updatedAt: '2026-08-29T12:00:00Z'
    };

    const text = generateNoticePlainText(piece);
    expect(text).toContain('USPS CERTIFIED MAIL® PREPARATION & JOURNAL NOTICE');
    expect(text).toContain('ARTICLE NUMBER (USER-ENTERED): 9407 1118 9956 2210 4401 22');
    expect(text).toContain('Jane Doe');
    expect(text).toContain('Acme Landlord LLC');
    expect(text).toContain('EVIDENCE JOURNAL & LIFECYCLE SUMMARY');
    expect(text).toContain('PS 3800 Acceptance Postmark');
    expect(text).toContain('DISCLAIMER: This notice was prepared with Certified Mailer');
    expect(text.replace(/\s+/g, ' ')).toContain('not affiliated with or endorsed by the USPS');
  });

  it('handles address formatting when addressLine2 is omitted', () => {
    const addr: USAddress = {
      name: 'John Doe',
      addressLine1: '500 Oak St',
      city: 'Dallas',
      state: 'TX',
      postalCode: '75001'
    };

    const multi = formatAddressMultiLine(addr);
    expect(multi).toBe('John Doe\n500 Oak St\nDallas, TX 75001');

    const single = formatAddressSingleLine(addr);
    expect(single).toBe('John Doe, 500 Oak St, Dallas, TX 75001');
  });
});

describe('Certified Mailer Domain - Schema Migration & Corrupt Payload Defense', () => {
  it('migrates legacy/incomplete mail piece objects by assigning IDs, timestamps, and empty history', () => {
    const rawLegacy = {
      title: 'Old Legacy Mail Piece',
      sender: { name: 'Old Sender', addressLine1: '123 St', city: 'City', state: 'NY', postalCode: '10001' },
      recipient: { name: 'Old Recipient', addressLine1: '456 St', city: 'City', state: 'NY', postalCode: '10001' },
      subject: 'Old Subject',
      body: 'Old Body',
      // Missing id, status, history, evidence, timestamps
    };

    const sanitized = sanitizeMailPiece(rawLegacy);
    expect(sanitized).not.toBeNull();
    expect(sanitized?.id).toMatch(/^mail_/);
    expect(sanitized?.status).toBe('draft');
    expect(sanitized?.history.length).toBeGreaterThanOrEqual(1);
    expect(sanitized?.evidence).toEqual([]);
    expect(sanitized?.createdAt).toBeDefined();
    expect(sanitized?.updatedAt).toBeDefined();
  });

  it('defends against nested injection payloads across all address and evidence fields', () => {
    const maliciousEvidence = {
      id: 'ev_1<script>alert(1)</script>',
      type: 'acceptance_receipt',
      title: 'Counter Stamp <iframe src="evil.com"></iframe>',
      source: 'Post Office <script>fetch("steal")</script>',
      observedDate: '2026-08-29',
      reference: 'REF<script>alert(2)</script>',
      notes: 'Safe notes with <script>hack()</script>'
    };

    const sanitized = sanitizeEvidenceRecord(maliciousEvidence);
    expect(sanitized).not.toBeNull();
    expect(sanitized?.title).not.toContain('<iframe');
    expect(sanitized?.source).not.toContain('<script');
    expect(sanitized?.reference).not.toContain('<script');
    expect(sanitized?.notes).not.toContain('<script');
    expect(sanitized?.notes).toContain('Safe notes with');
  });

  it('clamps oversized fields to prevent localStorage bloat', () => {
    const longName = 'A'.repeat(500);
    const longAddress = sanitizeAddress({ name: longName, addressLine1: longName, city: longName, state: 'TX', postalCode: '78701' });
    expect(longAddress.name.length).toBeLessThanOrEqual(100);
    expect(longAddress.addressLine1.length).toBeLessThanOrEqual(120);
    expect(longAddress.city.length).toBeLessThanOrEqual(60);
  });
});
