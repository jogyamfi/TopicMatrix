import { useSyncExternalStore } from 'react';

// A minimal, framework-agnostic toast store (same pattern as auth-store) so `toast()` can be
// called from event handlers, mutation callbacks, or plain modules — not just components.
export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}

type Listener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener(toasts);
}

export function toast(item: Omit<ToastItem, 'id'>): void {
  const id = crypto.randomUUID();
  toasts = [...toasts, { ...item, id }];
  emit();
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => toasts,
  );
}
