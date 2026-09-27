/**
 * phoneIdentity tests — pure logic of the Cab Share contact number
 * (plain, OTP-free model): E.164 normalization, the saved-number state
 * machine, masking, participation gate, and device capability token.
 *
 * Network/RPC behavior is intentionally not covered here; the SQL migration
 * (20260908000001) holds the authoritative rules server-side.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeToE164, maskedPhone, phoneIdentityReducer, initialPhoneIdentityState,
  canParticipate, makeDeviceCode, classifyPhoneBackendFailure, isLegacyIdentityShape,
  PhoneIdentityState,
} from '../phoneIdentity';

describe('classifyPhoneBackendFailure', () => {
  it('separates an invalid number from every other failure', () => {
    expect(classifyPhoneBackendFailure(400, 'PHONE_INVALID_NUMBER')).toBe('INVALID_NUMBER');
    expect(classifyPhoneBackendFailure(400, 'PHONE_INVALID_DEVICE')).toBe('INVALID_NUMBER');
    expect(classifyPhoneBackendFailure(400, 'PHONE_REQUIRED')).toBe('INVALID_NUMBER');
  });

  it('reports a stale deployment instead of a vague outage', () => {
    const missingRpc = JSON.stringify({
      code: 'PGRST202',
      message: 'Could not find the function public.set_phone_identity(p_device_code, p_phone_e164) in the schema cache',
    });
    expect(classifyPhoneBackendFailure(404, missingRpc)).toBe('BACKEND_OUTDATED');
    expect(classifyPhoneBackendFailure(400, 'PHONE_VERIFICATION_REQUIRED')).toBe('BACKEND_OUTDATED');
    expect(classifyPhoneBackendFailure(401, 'permission denied for function set_phone_identity')).toBe('BACKEND_OUTDATED');
    expect(classifyPhoneBackendFailure(403, '')).toBe('BACKEND_OUTDATED');
  });

  it('keeps genuine server problems as retryable failures', () => {
    expect(classifyPhoneBackendFailure(500, 'internal server error')).toBe('RPC_FAILED');
    expect(classifyPhoneBackendFailure(503, '')).toBe('RPC_FAILED');
  });
});

describe('isLegacyIdentityShape', () => {
  it('recognises the retired OTP-era payload', () => {
    expect(isLegacyIdentityShape({ verified: false })).toBe(true);
  });

  it('accepts the current OTP-free payload', () => {
    expect(isLegacyIdentityShape({ saved: false })).toBe(false);
    expect(isLegacyIdentityShape({ saved: true, last4: '3210', hideNumber: false })).toBe(false);
    expect(isLegacyIdentityShape(null)).toBe(false);
    expect(isLegacyIdentityShape('nope')).toBe(false);
  });
});

describe('normalizeToE164', () => {
  it('normalizes 10-digit Indian mobiles', () => {
    expect(normalizeToE164('9876543210')).toEqual({ ok: true, e164: '+919876543210' });
    expect(normalizeToE164('98765 43210')).toEqual({ ok: true, e164: '+919876543210' });
    expect(normalizeToE164('+91 98765-43210')).toEqual({ ok: true, e164: '+919876543210' });
  });

  it('strips the Indian trunk prefix', () => {
    expect(normalizeToE164('09876543210')).toEqual({ ok: true, e164: '+919876543210' });
  });

  it('accepts an explicit 91 country code', () => {
    expect(normalizeToE164('919876543210')).toEqual({ ok: true, e164: '+919876543210' });
  });

  it('rejects invalid Indian numbers without inventing one', () => {
    expect(normalizeToE164('1234567890').ok).toBe(false);
    expect(normalizeToE164('98765432').ok).toBe(false);
    expect(normalizeToE164('98765432101').ok).toBe(false);
    expect(normalizeToE164('').ok).toBe(false);
    expect(normalizeToE164('9876543210').e164).toBe('+919876543210');
  });

  it('keeps explicit international numbers as-is', () => {
    expect(normalizeToE164('+447911123456')).toEqual({ ok: true, e164: '+447911123456' });
    expect(normalizeToE164('+1 (415) 555-2671')).toEqual({ ok: true, e164: '+14155552671' });
  });

  it('rejects malformed international numbers', () => {
    expect(normalizeToE164('+44').ok).toBe(false);
    expect(normalizeToE164('+0123456789').ok).toBe(false);
    expect(normalizeToE164('+abc').ok).toBe(false);
  });
});

describe('maskedPhone', () => {
  it('renders only the server-issued last4 fragment', () => {
    expect(maskedPhone('4321')).toBe('•••••• 4321');
  });

  it('never leaks more than four digits', () => {
    expect(maskedPhone('12345678901')).toBe('•••••• 8901');
  });

  it('degrades safely for missing fragments', () => {
    expect(maskedPhone(null)).toBe('•••••• ••••');
    expect(maskedPhone('')).toBe('•••••• ••••');
  });
});

describe('saved-number state machine', () => {
  it('starts with no number and blocks participation', () => {
    expect(initialPhoneIdentityState.phase).toBe('none');
    expect(canParticipate(initialPhoneIdentityState)).toBe(false);
  });

  it('transitions none → saved on SAVED', () => {
    let state: PhoneIdentityState = initialPhoneIdentityState;
    state = phoneIdentityReducer(state, { type: 'SAVED', last4: '4321', hideNumber: false });
    expect(state).toEqual({ phase: 'saved', last4: '4321', hideNumber: false });
    expect(canParticipate(state)).toBe(true);
  });

  it('keeps hide-number changes only for devices with a saved number', () => {
    let state: PhoneIdentityState = initialPhoneIdentityState;
    state = phoneIdentityReducer(state, { type: 'HIDE_TOGGLED', hideNumber: true });
    expect(state.phase).toBe('none');
    state = phoneIdentityReducer(state, { type: 'SAVED', last4: '4321', hideNumber: false });
    state = phoneIdentityReducer(state, { type: 'HIDE_TOGGLED', hideNumber: true });
    expect(state).toEqual({ phase: 'saved', last4: '4321', hideNumber: true });
  });

  it('returns to none after revoking (number change)', () => {
    let state: PhoneIdentityState = { phase: 'saved', last4: '4321', hideNumber: false };
    state = phoneIdentityReducer(state, { type: 'REVOKED' });
    expect(state.phase).toBe('none');
    expect(canParticipate(state)).toBe(false);
  });

  it('re-saving replaces the stored fragment', () => {
    let state: PhoneIdentityState = initialPhoneIdentityState;
    state = phoneIdentityReducer(state, { type: 'SAVED', last4: '1111', hideNumber: false });
    state = phoneIdentityReducer(state, { type: 'SAVED', last4: '2222', hideNumber: true });
    expect(state).toEqual({ phase: 'saved', last4: '2222', hideNumber: true });
  });
});

describe('device capability token', () => {
  it('generates 24-character unambiguous codes', () => {
    const code = makeDeviceCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{24}$/);
    expect(makeDeviceCode()).not.toBe(code);
  });
});
