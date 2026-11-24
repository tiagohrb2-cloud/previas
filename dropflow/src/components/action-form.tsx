"use client";

import { createContext, startTransition, useActionState, useContext, useRef, useEffect, type ReactNode } from "react";
import { buttonClass, cn } from "./ui";

export type ActionResult = { ok: boolean; message: string; data?: unknown } | null;
export type FormAction = (prev: ActionResult, form: FormData) => Promise<ActionResult>;

const PendingContext = createContext(false);

/**
 * Formulário com mensagem de retorno e estado de envio (Server Actions).
 * O envio é feito manualmente para que os campos NÃO sejam apagados quando a
 * ação retorna erro (comportamento padrão do React ao usar `action` no form).
 */
export function ActionForm({
  action, children, className, resetOnSuccess, confirm,
}: { action: FormAction; children: ReactNode; className?: string; resetOnSuccess?: boolean; confirm?: string }) {
  const [state, dispatch, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        if (confirm && !window.confirm(confirm)) return;
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const data = new FormData(e.currentTarget, submitter);
        startTransition(() => dispatch(data));
      }}
    >
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      {state?.message && !pending && (
        <p role="status" className={cn("mt-3 whitespace-pre-line rounded-lg px-3 py-2 text-sm", state.ok ? "bg-brand-50 text-brand-800" : "bg-rose-50 text-rose-700")}>
          {state.message}
        </p>
      )}
    </form>
  );
}

export function SubmitButton({ children, variant = "primary", size = "md", className, name, value }: { children: ReactNode; variant?: Parameters<typeof buttonClass>[0]; size?: "sm" | "md"; className?: string; name?: string; value?: string }) {
  const pending = useContext(PendingContext);
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={cn(buttonClass(variant, size), className)}>
      {pending && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}
