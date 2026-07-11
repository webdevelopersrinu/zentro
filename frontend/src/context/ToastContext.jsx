import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { X } from "lucide-react";

import { cx } from "../lib/cx.js";
import styles from "./ToastContext.module.css";

const ToastContext = createContext(null);
const AUTO_DISMISS_MS = 4000;

let nextId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback(
    (message, { variant = "info", duration = AUTO_DISMISS_MS } = {}) => {
      const id = (nextId += 1);
      setToasts((current) => [...current, { id, message, variant }]);

      /**
       * An error toast is, for most flows in this app, the ONLY report that
       * something failed. Four seconds is not enough to read one, so errors
       * stay until they are dismissed. Success and info still expire.
       */
      if (duration && variant !== "error") setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss]
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* aria-live announces new toasts to screen readers without stealing focus */}
      <div
        className={styles.viewport}
        role="region"
        aria-live="polite"
        aria-label="Notifications"
      >
        {toasts.map(({ id, message, variant }) => (
          <div
            key={id}
            className={cx(styles.toast, styles[variant])}
            /* An error interrupts: it must not queue behind whatever is being read. */
            role={variant === "error" ? "alert" : undefined}
            aria-live={variant === "error" ? "assertive" : undefined}
          >
            <span className={styles.message}>{message}</span>
            <button className={styles.close} onClick={() => dismiss(id)} aria-label="Dismiss">
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within a ToastProvider");
  return context;
}
