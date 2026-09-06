import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/** Moves focus to the main content region on every route change (NF-4) — otherwise focus stays
 * on whatever link/button triggered the navigation, which is disorienting for keyboard/screen
 * reader users. */
export function useRouteFocus(): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    ref.current?.focus();
  }, [location.pathname]);

  return ref;
}
