import { describe, expect, it } from 'vitest';
import { createStudySessionRequestSchema } from '@topicmatrix/shared';
import { ApiError } from './api-error';
import { FORM_ERROR, fieldErrorsFromApi, fieldErrorsFromZod } from './form-errors';

function zodErrorFor(body: unknown) {
  const result = createStudySessionRequestSchema.safeParse(body);
  if (result.success) throw new Error('expected validation to fail');
  return result.error;
}

describe('fieldErrorsFromZod', () => {
  it('maps each field to its first message, with a friendly one for blank numbers', () => {
    const errors = fieldErrorsFromZod(
      zodErrorFor({ questionsAttempted: Number.NaN, questionsCorrect: 3, confidence: 9 }),
    );
    expect(errors.questionsAttempted).toBe('Enter a number');
    expect(errors.confidence).toMatch(/less than or equal to 5/);
  });

  it('attaches a cross-field refine to the field its path names', () => {
    const errors = fieldErrorsFromZod(zodErrorFor({ questionsAttempted: 5, questionsCorrect: 8, confidence: 3 }));
    expect(errors.questionsCorrect).toBe('Questions correct cannot be more than questions attempted');
  });
});

describe('fieldErrorsFromApi', () => {
  it("maps the server's flatten() payload onto fields", () => {
    const err = new ApiError(422, 'VALIDATION_FAILED', 'name: Required', {
      fieldErrors: { name: ['Required'], colour: ['Invalid colour'] },
      formErrors: [],
    });
    expect(fieldErrorsFromApi(err, 'fallback')).toEqual({ name: 'Required', colour: 'Invalid colour' });
  });

  it('attaches a route-level check ({ field: reason }) to its field using the top-level message', () => {
    const err = new ApiError(422, 'VALIDATION_FAILED', 'studiedOn cannot be in the future', {
      studiedOn: 'in the future',
    });
    expect(fieldErrorsFromApi(err, 'fallback')).toEqual({ studiedOn: 'studiedOn cannot be in the future' });
  });

  it('falls back to a form-level error for anything else', () => {
    expect(fieldErrorsFromApi(new ApiError(409, 'CONFLICT', 'Name already exists'), 'fallback')).toEqual({
      [FORM_ERROR]: 'Name already exists',
    });
    expect(fieldErrorsFromApi('boom', 'Could not save')).toEqual({ [FORM_ERROR]: 'Could not save' });
  });
});
