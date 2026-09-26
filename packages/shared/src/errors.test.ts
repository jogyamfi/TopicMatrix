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

  it('maps TOPIC_CYCLE to a 400 (FR-3.4)', () => {
    const err = new AppError('TOPIC_CYCLE', 'Cannot move a topic into itself or a descendant');
    const { status, body } = toErrorEnvelope(err, { exposeDetails: true });
    expect(status).toBe(400);
    expect(body.error.code).toBe('TOPIC_CYCLE');
  });

  it('always exposes the details of a client (4xx) error, since they describe the caller request', () => {
    const err = new AppError('VALIDATION_FAILED', 'invalid', { field: 'name' });
    expect(toErrorEnvelope(err, { exposeDetails: false }).body.error.details).toEqual({ field: 'name' });
    expect(toErrorEnvelope(err, { exposeDetails: true }).body.error.details).toEqual({ field: 'name' });
  });

  it('hides the message and details of a server (5xx) AppError unless exposeDetails is true', () => {
    const err = new AppError('INTERNAL_ERROR', 'Missing computed metrics for topic abc', { topicId: 'abc' });
    const prod = toErrorEnvelope(err, { exposeDetails: false });
    expect(prod.status).toBe(500);
    expect(prod.body.error.message).toBe('Internal server error');
    expect(prod.body.error.details).toBeUndefined();

    const dev = toErrorEnvelope(err, { exposeDetails: true });
    expect(dev.body.error.message).toBe('Missing computed metrics for topic abc');
    expect(dev.body.error.details).toEqual({ topicId: 'abc' });
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
