import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from './ui/toast';
import { dismissToast, useToasts } from '../lib/toast-store';

/** The toast host (P6 task 7/9) — a single `aria-live` region (built into Radix Toast's
 * viewport) mounted once at the app root. */
export function Toaster(): React.JSX.Element {
  const toasts = useToasts();

  return (
    <ToastProvider swipeDirection="right">
      {toasts.map(({ id, title, description, variant }) => (
        <Toast key={id} variant={variant} onOpenChange={(open) => !open && dismissToast(id)}>
          <div className="grid gap-1">
            <ToastTitle>{title}</ToastTitle>
            {description ? <ToastDescription>{description}</ToastDescription> : null}
          </div>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
