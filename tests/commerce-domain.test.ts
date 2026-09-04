import { describe, it, expect } from 'vitest';
import {
  validateGrossCents,
  validateCurrency,
  CommerceValidationError,
} from '../src/lib/commerceDomain';

describe('Durable Commerce Domain Logic & Allocation Engine', () => {
  describe('1. Gross Cents & Money Validation', () => {
    it.each([1, 10, 1500, 2000, 2500, 100000, Number.MAX_SAFE_INTEGER])(
      'accepts valid positive integer cents: %i',
      (cents) => {
        expect(validateGrossCents(cents)).toBe(cents);
      }
    );

    it.each([
      [0, 'zero cents'],
      [-1, 'negative cents'],
      [-1500, 'negative large cents'],
      [15.5, 'fractional float cents'],
      [0.99, 'fractional cents'],
      [NaN, 'NaN'],
      [Infinity, 'Infinity'],
      [-Infinity, '-Infinity'],
      ['1500', 'string value'],
      [null, 'null'],
      [undefined, 'undefined'],
      [{}, 'object'],
      [Number.MAX_SAFE_INTEGER + 1, 'unsafe integer']
    ])('rejects invalid money value %s (%s)', (invalidVal, _desc) => {
      expect(() => validateGrossCents(invalidVal)).toThrow(CommerceValidationError);
    });
  });

  describe('2. Currency Validation', () => {
    it.each(['usd', 'eur', 'gbp', 'cad', 'jpy'])('accepts valid 3-letter lowercase currency: %s', (curr) => {
      expect(validateCurrency(curr)).toBe(curr);
    });

    it.each([
      ['USD', 'uppercase'],
      ['Usd', 'mixed case'],
      ['us', 'too short'],
      ['usdt', 'too long'],
      ['$$$', 'symbols'],
      ['123', 'digits'],
      ['', 'empty string'],
      [null, 'null'],
      [undefined, 'undefined'],
      [123, 'number']
    ])('rejects invalid currency code %s (%s)', (invalidCurr, _desc) => {
      expect(() => validateCurrency(invalidCurr)).toThrow(CommerceValidationError);
    });
  });
});
