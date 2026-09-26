import {
  type ButtonHTMLAttributes,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { Modal } from "./modal";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** Render the confirm button in danger style. */
  destructive?: boolean;
  /** Hide the cancel button — turns this into an info-only dialog. */
  alertOnly?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within ConfirmProvider");
  }
  return ctx;
}

/** Info-only dialog. Resolves when user dismisses. */
export function useAlert(): (message: string, title?: string) => Promise<void> {
  const confirm = useConfirm();
  return useCallback(
    async (message, title) => {
      await confirm({ message, title, alertOnly: true, confirmText: "OK" });
    },
    [confirm],
  );
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm: ConfirmFn = useCallback(
    (opts) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...opts, resolve });
      }),
    [],
  );

  const respond = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={pending != null}
        onClose={() => respond(false)}
        title={pending?.title ?? "Potwierdź"}
      >
        {pending && (
          <>
            <div className="modal-body">
              <p
                style={{
                  fontSize: 14,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  margin: 0,
                }}
              >
                {pending.message}
              </p>
            </div>
            <div className="modal-foot">
              {!pending.alertOnly && (
                <button type="button" onClick={() => respond(false)} className="btn btn-ghost">
                  {pending.cancelText ?? "Anuluj"}
                </button>
              )}
              <button
                type="button"
                onClick={() => respond(true)}
                className={pending.destructive ? "btn btn-danger" : "btn btn-primary"}
                ref={(el) => {
                  // Focus the confirm button when it mounts so Enter confirms.
                  el?.focus();
                }}
              >
                {pending.confirmText ?? "Potwierdź"}
              </button>
            </div>
          </>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}

/**
 * Submit button that prompts the user before submitting its form. The form
 * is only submitted if the user confirms; the original `name`/`value` (so the
 * intent dispatch keeps working) are preserved via `form.requestSubmit(this)`.
 */
interface ConfirmSubmitButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  confirmOptions: ConfirmOptions;
  children: ReactNode;
}

export function ConfirmSubmitButton({
  confirmOptions,
  children,
  ...rest
}: ConfirmSubmitButtonProps) {
  const innerRef = useRef<HTMLButtonElement>(null);
  const confirm = useConfirm();

  return (
    <button
      ref={innerRef}
      type="submit"
      {...rest}
      onClick={async (e) => {
        e.preventDefault();
        const ok = await confirm(confirmOptions);
        if (!ok) return;
        const btn = innerRef.current;
        btn?.form?.requestSubmit(btn);
      }}
    >
      {children}
    </button>
  );
}
