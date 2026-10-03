import {
  type ActionFunctionArgs,
  Form,
  Link,
  type LoaderFunctionArgs,
  redirect,
  useActionData,
  useNavigation,
} from "react-router";
import { z } from "zod";
import { optionalUser, sectionFor } from "~/lib/api/auth";
import { RegistrationError, requestRegistration } from "~/lib/auth";

/**
 * Rejestracja trenera, krok 1: adres, na który BE wyśle link (`POST /v1/registrations`).
 * Konta po tym kroku jeszcze nie ma — zakłada je dopiero krok 2, pod adresem z maila
 * (`/rejestracja/:token`).
 */
const ZgloszenieSchema = z.object({ email: z.string().trim().email().max(254) });

export function loader({ context }: LoaderFunctionArgs) {
  // Synchronicznie i bez sieci, jak w `login.tsx`: użytkownika załadował middleware.
  const { user } = optionalUser(context);
  if (user) throw redirect(sectionFor(user));
  return null;
}

export async function action(args: ActionFunctionArgs) {
  const { api } = optionalUser(args.context);
  const fd = await args.request.formData();
  // Kształt adresu rozstrzyga Zod PRZED modułem — oczywiście zły adres nie kosztuje wywołania BE.
  const parsed = ZgloszenieSchema.safeParse({ email: fd.get("email") });
  if (!parsed.success) {
    return { blad: "Podaj poprawny adres e-mail.", odmowa: "invalid-email" as const };
  }

  try {
    await requestRegistration(api, parsed.data.email);
    return { wyslano: parsed.data.email };
  } catch (e) {
    // Wąsko: `RegistrationError` to komunikat w formularzu, wszystko inne (awaria BE) leci do
    // granicy błędu. Pomylenie tych dwóch kazałoby poprawiać adres w odpowiedzi na cudzą usterkę.
    if (e instanceof RegistrationError) return { blad: e.userMessage, odmowa: e.refusal };
    throw e;
  }
}

export default function Rejestracja() {
  const wynik = useActionData<typeof action>();
  const navigation = useNavigation();
  // Oba przyciski wysyłki są zablokowane na czas nawigacji: podwójne kliknięcie „Wyślij ponownie”
  // zjada dwa z trzech linków na godzinę (limit na adres kanoniczny). `!== "idle"`, nie samo
  // "submitting": wynik akcji trafia na ekran jeszcze w fazie "loading" (rewalidacja loadera), więc
  // „Wyślij ponownie” bywa już widoczne, gdy nawigacja trwa — kliknięcie w tym oknie wysłałoby to
  // samo zgłoszenie drugi raz.
  const busy = navigation.state !== "idle";
  const wyslano = wynik && "wyslano" in wynik ? wynik.wyslano : null;
  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="brand" style={{ marginBottom: 18 }}>
          <span className="brand-mark" />
          <span>calisthenos</span>
          <span className="brand-dot" />
        </div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Rejestracja trenera
        </div>
        {wyslano ? (
          <>
            <h1 style={{ fontSize: 22, marginBottom: 8 }}>Sprawdź skrzynkę</h1>
            <p className="muted" style={{ marginBottom: 18 }}>
              Wysłaliśmy link na {wyslano}. Link jest ważny 24 godziny i działa jeden raz.
            </p>
            {/* To samo zgłoszenie jeszcze raz — ta sama akcja, więc te same limity i odmowy. */}
            <Form method="post">
              <input type="hidden" name="email" value={wyslano} />
              <button type="submit" className="btn btn-lg" disabled={busy}>
                Wyślij ponownie
              </button>
            </Form>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 22, marginBottom: 18 }}>Załóż konto trenera</h1>
            <Form method="post" style={{ display: "grid", gap: 14 }}>
              <div className="field">
                <label htmlFor="reg-email">Email</label>
                <input
                  id="reg-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="input"
                />
              </div>
              {wynik && "blad" in wynik && (
                <p role="alert" style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>
                  {wynik.blad}{" "}
                  {wynik.odmowa === "email-taken" && <Link to="/login">Przejdź do logowania</Link>}
                </p>
              )}
              <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
                Wyślij link
              </button>
            </Form>
          </>
        )}
      </div>
    </main>
  );
}
