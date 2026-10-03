import {
  type ActionFunctionArgs,
  Form,
  Link,
  type LoaderFunctionArgs,
  redirect,
  useActionData,
} from "react-router";
import { z } from "zod";
import { optionalUser, sectionFor } from "~/lib/api/auth";
import { AuthError, startSession } from "~/lib/api/auth-session";
import { buildSessionCookie } from "~/lib/api/session";

const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(1024),
});

const GENERIC_ERROR = "Niepoprawne dane logowania." as const;

export function loader({ context }: LoaderFunctionArgs) {
  // Synchronicznie i bez sieci: użytkownika załadował middleware raz na
  // żądanie. Do integracji ta trasa czytała sesję z bazy przy każdym wejściu.
  const { user } = optionalUser(context);
  if (user) throw redirect(sectionFor(user));
  return null;
}

export async function action(args: ActionFunctionArgs) {
  const { api } = optionalUser(args.context);
  const formData = await args.request.formData();
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  // Bez dummy-hash: BE liczy pełny hasz także dla NIEISTNIEJĄCEGO konta
  // (`libs/iam/src/lib/auth.service.ts`), więc czas odpowiedzi nie zdradza już
  // istnienia adresu i podtrzymywanie tego po stronie FE nic by nie chroniło.
  // Bez `enforceRateLimit`: limit prób stoi w BE i jest kluczowany e-mailem
  // z ciała żądania, nie adresem IP — czyli po koncie, które ktoś atakuje,
  // a nie po łączu, które podopieczni dzielą przez NAT.
  if (!parsed.success) return { error: GENERIC_ERROR };

  try {
    const { session, user } = await startSession(api, parsed.data);
    return redirect(sectionFor(user), {
      headers: { "Set-Cookie": buildSessionCookie(session) },
    });
  } catch (e) {
    // Wąsko: `AuthError` to komunikat w formularzu, wszystko inne (awaria BE)
    // leci do granicy błędu. Pomylenie tych dwóch kazałoby użytkownikowi
    // sprawdzać hasło w odpowiedzi na cudzą usterkę.
    if (e instanceof AuthError) return { error: e.userMessage };
    throw e;
  }
}

export default function Login() {
  const actionData = useActionData<typeof action>();
  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="brand" style={{ marginBottom: 18 }}>
          <span className="brand-mark" />
          <span>calisthenos</span>
          <span className="brand-dot" />
        </div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Logowanie
        </div>
        <h1 style={{ fontSize: 22, marginBottom: 18 }}>Wróć do treningu</h1>
        <Form method="post" style={{ display: "grid", gap: 14 }}>
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="input"
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">Hasło</label>
            <input
              id="login-password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="input"
            />
          </div>
          {actionData && "error" in actionData && (
            <p role="alert" style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>
              {actionData.error}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-lg" style={{ marginTop: 4 }}>
            Zaloguj
          </button>
        </Form>
        <p className="muted" style={{ marginTop: 18, fontSize: 13 }}>
          Nie masz konta? <Link to="/rejestracja">Załóż konto trenera</Link>
        </p>
      </div>
    </main>
  );
}
