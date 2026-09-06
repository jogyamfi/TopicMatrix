import { describe, expect, it } from 'vitest';
import { AppError, toErrorEnvelope } from './errors.js';

describe('toErrorEnvelope', () => {
  it('maps a known AppError to its status and code', () => {
    const err = new AppError('NOT_FOUND', 'Subject not found');
    const { status, body } = toErrorEnvelope(err, { exposeDetails: true });
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Subject not found');
  });

  it('suppresses details unless exposeDetails is true', () => {
    const err = new AppError('VALIDATION_FAILED', 'invalid', { field: 'name' });
    expect(toErrorEnvelope(err, { exposeDetails: false }).body.error.details).toBeUndefined();
    expect(toErrorEnvelope(err, { exposeDetails: true }).body.error.details).toEqual({
      field: 'name',
    });
  });

  it('maps an unknown error to a generic 500 and hides the message in production', () => {
    const err = new Error('leaked internal detail');
    const prod = toErrorEnvelope(err, { exposeDetails: false });
    expect(prod.status).toBe(500);
    expect(prod.body.error.code).toBe('INTERNAL_ERROR');
    expect(prod.body.error.message).toBe('Internal server error');

    const dev = toErrorEnvelope(err, { exposeDetails: true });
    expect(dev.body.error.message).toBe('leaked internal detail');
  });
});
