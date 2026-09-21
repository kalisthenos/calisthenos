import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type ToastTone = "success" | "error" | "info";

interface ToastEntry {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastOptions {
  tone?: ToastTone;
  /** Auto-dismiss after N ms. Defaults to 3000; pass 0 to keep until clicked. */
  durationMs?: number;
}

type ToastFn = (message: string, opts?: ToastOptions) => void;

const ToastContext = createContext<ToastFn | null>(null);

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show: ToastFn = useCallback(
    (message, opts = {}) => {
      idRef.current += 1;
      const id = idRef.current;
      const tone = opts.tone ?? "success";
      setToasts((prev) => [...prev, { id, message, tone }]);
      const duration = opts.durationMs ?? 3000;
      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastEntry[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      style={{
        position: "fixed",
        bottom: 22,
        left: 0,
        right: 0,
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastEntry;
  onDismiss: () => void;
}) {
  // Enter animation: rely on existing `.toast` rules in tokens.css.
  useEffect(() => {
    // no-op; provided in case we add exit animation later
  }, []);

  const dotColor =
    toast.tone === "error"
      ? "var(--danger)"
      : toast.tone === "info"
        ? "var(--accent)"
        : "var(--ok)";

  return (
    <button
      type="button"
      onClick={onDismiss}
      className="toast"
      style={{
        pointerEvents: "auto",
        position: "static",
        transform: "none",
        cursor: "pointer",
        border: 0,
      }}
      aria-label="Zamknij powiadomienie"
    >
      <span className="dot" style={{ background: dotColor }} />
      {toast.message}
    </button>
  );
}
