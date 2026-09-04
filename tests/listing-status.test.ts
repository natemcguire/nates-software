import { describe, expect, it } from 'vitest';
import { deriveListingStatus } from '../src/lib/listingStatus';

describe('mutually exclusive listing status', () => {
  it.each([
    [{ isDemo: true, hasCanonicalRepo: true, productStatus: 'active', isAuthoritativeLive: true }, 'SHOWCASE'],
    [{ isDemo: false, hasCanonicalRepo: true, productStatus: 'active', isAuthoritativeLive: false }, 'SHOWCASE'],
    [{ isDemo: false, hasCanonicalRepo: false, productStatus: 'active', isAuthoritativeLive: true }, 'LISTED — NO SOURCE'],
    [{ isDemo: false, hasCanonicalRepo: true, productStatus: 'draft', isAuthoritativeLive: true }, 'DRAFT'],
    [{ isDemo: false, hasCanonicalRepo: true, productStatus: 'active', isAuthoritativeLive: true }, 'FOR SALE']
  ])('derives one status', (input, expected) => {
    expect(deriveListingStatus(input).label).toBe(expected);
  });
});
