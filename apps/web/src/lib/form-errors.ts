import { useCallback, useEffect, useState } from 'react';
import type { ZodError, ZodIssue } from 'zod';
import { ApiError } from './api-error';

// Field-level form errors (R3 U-8). Two sources feed the same map:
// - client-side validation with the shared Zod request schemas, before anything is sent;
// - the server's VALIDATION_FAILED `details`, which is Zod's `flatten()` (`fieldErrors`) or, for
//   route-level checks, `{ field: reason }` alongside a human-readable top-level message.
// Anything that can't be pinned to a field lands under FORM_ERROR and is shown for the form.

export const FORM_ERROR = '_form';
export type FieldErrors = Readonly<Record<string, string>>;

function describeIssue(issue: ZodIssue): string {
  // `Number.parseInt('')` is NaN — "Expected number, received nan" means "left blank".
  if (issue.code === 'invalid_type' && issue.received === 'nan') {
    return 'Enter a number';
  }
  if (issue.code === 'invalid_type' && issue.received === 'undefined') {
    return 'Required';
  }
  return issue.message;
}

/** First message per top-level field; path-less issues become the form-level error. */
export function fieldErrorsFromZod(error: ZodError): FieldErrors {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : FORM_ERROR;
    errors[key] ??= describeIssue(issue);
  }
  return errors;
}

function isStringArrayRecord(value: unknown): value is Record<string, string[] | undefined> {
  return typeof value === 'object' && value !== null;
}

/**
 * Maps a failed request onto fields. A VALIDATION_FAILED `flatten()` payload gives per-field
 * messages; a route-level `{ field: reason }` payload attaches the top-level message to that
 * field. Everything else is a form-level error.
 */
export function fieldErrorsFromApi(error: unknown, fallback: string): FieldErrors {
  if (!(error instanceof ApiError)) {
    return { [FORM_ERROR]: error instanceof Error ? error.message : fallback };
  }
  const details = error.details;
  const errors: Record<string, string> = {};
  if (error.code === 'VALIDATION_FAILED' && typeof details === 'object' && details !== null) {
    const flattened = details as { fieldErrors?: unknown; formErrors?: unknown };
    if (isStringArrayRecord(flattened.fieldErrors)) {
      for (const [field, messages] of Object.entries(flattened.fieldErrors)) {
        const first = Array.isArray(messages) ? messages[0] : undefined;
        if (first) errors[field] = first;
      }
      const formErrors = Array.isArray(flattened.formErrors) ? (flattened.formErrors as string[]) : [];
      if (formErrors[0]) errors[FORM_ERROR] = formErrors[0];
    } else {
      for (const [field, reason] of Object.entries(details as Record<string, unknown>)) {
        if (typeof reason === 'string') errors[field] = error.message;
      }
    }
  }
  if (Object.keys(errors).length === 0) {
    errors[FORM_ERROR] = error.message || fallback;
  }
  return errors;
}

export interface FormErrorsApi {
  errors: FieldErrors;
  /** The form-level message, if any. */
  formError: string | undefined;
  clear(): void;
  /** Validates `value` against `schema`; records field errors and returns false if it fails. */
  validate(schema: { safeParse(value: unknown): { success: true } | { success: false; error: ZodError } }, value: unknown): boolean;
  setFromApi(error: unknown, fallback: string): void;
  /** Accessibility props for the input showing `name` (`aria-invalid`, `aria-describedby`). */
  fieldProps(name: string, inputId: string): { 'aria-invalid'?: true; 'aria-describedby'?: string };
}

/** The id `<FieldError>` renders its message under, for `aria-describedby`. */
export function fieldErrorId(inputId: string): string {
  return `${inputId}-error`;
}

export function useFormErrors(): FormErrorsApi {
  const [errors, setErrors] = useState<FieldErrors>({});

  // After a failed submit, move focus to the first invalid field so keyboard and screen-reader
  // users land on the problem (its message is read out via aria-describedby). Forms here live in
  // modal dialogs or alone on a page, so the first invalid element in the document is this form's.
  useEffect(() => {
    if (Object.keys(errors).some((key) => key !== FORM_ERROR)) {
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [errors]);

  const clear = useCallback(() => setErrors({}), []);
  const validate = useCallback<FormErrorsApi['validate']>((schema, value) => {
    const result = schema.safeParse(value);
    if (result.success) {
      setErrors({});
      return true;
    }
    setErrors(fieldErrorsFromZod(result.error));
    return false;
  }, []);
  const setFromApi = useCallback((error: unknown, fallback: string) => {
    setErrors(fieldErrorsFromApi(error, fallback));
  }, []);

  return {
    errors,
    formError: errors[FORM_ERROR],
    clear,
    validate,
    setFromApi,
    fieldProps: (name, inputId) =>
      errors[name] ? { 'aria-invalid': true, 'aria-describedby': fieldErrorId(inputId) } : {},
  };
}
