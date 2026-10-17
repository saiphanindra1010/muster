import { useEffect, useRef } from "react";

/**
 * Close-on-Escape for modal surfaces. The listener is bound once — the
 * callback is read through a ref so frequent re-renders (streaming text)
 * don't churn the listener.
 */
export function useEscape(onClose: () => void): void {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") ref.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
