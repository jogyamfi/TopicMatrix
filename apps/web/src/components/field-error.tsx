import { fieldErrorId } from '../lib/form-errors';

/** A field's validation message, linked to its input via `aria-describedby` (see `useFormErrors`). */
export function FieldError({ inputId, message }: { inputId: string; message: string | undefined }): React.JSX.Element | null {
  if (!message) return null;
  return (
    <p id={fieldErrorId(inputId)} className="text-xs text-destructive">
      {message}
    </p>
  );
}

/** The form-level message — anything that can't be pinned to one field. */
export function FormError({ message }: { message: string | undefined }): React.JSX.Element | null {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
