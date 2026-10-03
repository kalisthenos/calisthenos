import {
  type ActionFunctionArgs,
  Form,
  type HeadersArgs,
  Link,
  type LoaderFunctionArgs,
  type MetaFunction,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { z } from "zod";
import { optionalUser, sectionFor } from "~/lib/api/auth";
import { completeRegistration } from "~/lib/api/auth-session";
import { buildSessionCookie } from "~/lib/api/session";
import { RegistrationError, previewRegistration } from "~/lib/auth";

/**
 * Rejestracja trenera, krok 2: link z maila (`/rejestracja/:token`). Człowiek widzi adres, na który
 * poszedł link, i zgody do zaakceptowania; po wysłaniu BE zakłada konto, zapisuje zgody z numerami
 * wersji, które właśnie zobaczył, i wystawia sesję (`POST /v1/registrations/{token}/complete`).
 * Krok 1 — zgłoszenie adresu — to `rejestracja.tsx`.
 */

/**
 * Token stoi w adresie — nie może wyciec nagłówkiem `Referer` ani zostać w pamięci pośredników.
 *
 * `strict-origin`, nie `no-referrer`. W `Referer` wychodzi wtedy sam origin, nigdy ścieżka, więc
 * token zostaje na stronie, a przeglądarka dalej wysyła prawdziwy `Origin` przy POST-cie na ten
 * sam adres. Przy `no-referrer` natywny POST formularza (bez JS albo przed hydratacją) niesie
 * `Origin: null`; sprawdzenie CSRF w react-router (`throwIfPotentialCSRFAttack`) traktuje je jak
 * obcy origin i odrzuca akcję odpowiedzią `400`. Wysyłka z JS (`fetch` w trybie `cors`) przeszłaby
 * w obu przypadkach, więc ten błąd nie ujawnia się w zwykłym użyciu.
 *
 * Kopia nagłówków rodzica jest tu konieczna, nie ozdobna: trasa z własnym `headers` NIE dziedziczy
 * nagłówków `root.tsx`. Router składa je od nowa z tego, co zwróci ta funkcja, a z rodzica przenosi
 * wyłącznie `Set-Cookie` (`getDocumentHeaders` w react-router, także dla odpowiedzi `.data`).
 * Bez kopii strona z polem hasła i tokenem w adresie straciłaby CSP, HSTS, `nosniff`
 * i `Permissions-Policy` — bez żadnego objawu, bo przeglądarka nic nie zgłasza.
 */
export function headers({ parentHeaders }: HeadersArgs): Headers {
  const naglowki = new Headers(parentHeaders);
  naglowki.set("Referrer-Policy", "strict-origin");
  naglowki.set("Cache-Control", "no-store");
  return naglowki;
}

export const meta: MetaFunction = () => [
  { title: "Dokończ rejestrację — kalisthenos" },
  // Token w adresie i adres e-mail na stronie — nic z tego nie ma trafiać do wyszukiwarki.
  { name: "robots", content: "noindex" },
];

const DokonczenieSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  password: z.string().min(8).max(1024),
});

/** Wartość pola zgody: `klucz:numerWersji` — wersja, którą osoba właśnie widzi. */
function zgodyZFormularza(
  wartosci: FormDataEntryValue[],
): { key: string; versionNumber: number }[] {
  return wartosci.flatMap((w) => {
    const [key, numer] = String(w).split(":");
    const versionNumber = Number(numer);
    return key && Number.isInteger(versionNumber) && versionNumber > 0
      ? [{ key, versionNumber }]
      : [];
  });
}

/**
 * Stan ekranu wraca danymi, nie wyjątkiem: każda odmowa BE przy podglądzie to coś, co człowiek ma
 * zobaczyć na stronie — link nieważny (jeden `404` na nieistniejący, zużyty i wygasły), adres, który
 * tymczasem dostał konto, wyłącznik rejestracji i limit żądań (spec §9.2: na wszystkich ekranach).
 * Awaria BE zostaje awarią i leci do granicy błędu.
 */
export async function loader(args: LoaderFunctionArgs) {
  const { api, user } = optionalUser(args.context);
  if (user) throw redirect(sectionFor(user));
  try {
    const podglad = await previewRegistration(api, args.params.token ?? "");
    if (!podglad) return { stan: "link-niewazny" as const };
    return { stan: "formularz" as const, email: podglad.email, zgody: podglad.requiredConsents };
  } catch (e) {
    if (e instanceof RegistrationError && e.refusal === "email-taken") {
      return { stan: "adres-zajety" as const };
    }
    if (e instanceof RegistrationError && e.refusal === "registration-closed") {
      return { stan: "rejestracja-zamknieta" as const };
    }
    if (e instanceof RegistrationError && e.refusal === "rate-limited") {
      return { stan: "limit" as const, blad: e.userMessage };
    }
    throw e;
  }
}

export async function action(args: ActionFunctionArgs) {
  const { api } = optionalUser(args.context);
  const fd = await args.request.formData();
  const parsed = DokonczenieSchema.safeParse({
    displayName: fd.get("displayName"),
    password: fd.get("password"),
  });
  if (!parsed.success) return { blad: "Sprawdź pola formularza." };
  try {
    const session = await completeRegistration(api, args.params.token ?? "", {
      ...parsed.data,
      acceptedConsents: zgodyZFormularza(fd.getAll("zgoda")),
    });
    // Na `/`, nie do sekcji — sekcję rozstrzyga `/v1/me` z następnego żądania (jak zaproszenie).
    return redirect("/", { headers: { "Set-Cookie": buildSessionCookie(session) } });
  } catch (e) {
    // Wąsko: `RegistrationError` to komunikat w formularzu, wszystko inne (awaria BE) leci do
    // granicy błędu. Pomylenie tych dwóch kazałoby poprawiać pola w odpowiedzi na cudzą usterkę.
    if (e instanceof RegistrationError) return { blad: e.userMessage, odmowa: e.refusal };
    throw e;
  }
}

/** Wspólna oprawa każdego widoku: marka, nadtytuł i treść stanu. */
function Karta({ children }: { children: React.ReactNode }) {
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
        {children}
      </div>
    </main>
  );
}

export default function RejestracjaToken() {
  const dane = useLoaderData<typeof loader>();
  const wynik = useActionData<typeof action>();
  const navigation = useNavigation();
  // „Załóż konto” jest zablokowane na czas nawigacji: drugie kliknięcie trafiłoby na token już
  // zużyty — osoba ma konto, a zobaczyłaby „Link jest nieważny albo wygasł”. `!== "idle"`, nie samo
  // "submitting": po udanym dokończeniu akcja odpowiada przekierowaniem i nawigacja przechodzi
  // w "loading", a formularz stoi na ekranie, dopóki nie skończy się ładowanie `/`.
  const busy = navigation.state !== "idle";

  if (dane.stan === "link-niewazny") {
    return (
      <Karta>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Link jest nieważny albo wygasł</h1>
        <p className="muted" style={{ marginBottom: 18 }}>
          Linki działają 24 godziny i jeden raz.
        </p>
        <Link to="/rejestracja" className="btn btn-primary btn-lg">
          Wyślij nowy link
        </Link>
      </Karta>
    );
  }

  if (dane.stan === "adres-zajety") {
    return (
      <Karta>
        <h1 style={{ fontSize: 22, marginBottom: 18 }}>Ten adres ma już konto</h1>
        <Link to="/login" className="btn btn-primary btn-lg">
          Zaloguj się
        </Link>
      </Karta>
    );
  }

  if (dane.stan === "rejestracja-zamknieta") {
    // Bez formularza i bez „Wyślij nowy link”: nowy link nie pomoże, dopóki rejestracja jest zamknięta.
    return (
      <Karta>
        <h1 style={{ fontSize: 22 }}>Rejestracja kont trenerów jest chwilowo zamknięta.</h1>
      </Karta>
    );
  }

  if (dane.stan === "limit") {
    return (
      <Karta>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Za dużo prób</h1>
        <p className="muted" style={{ marginBottom: 18 }}>
          {dane.blad}
        </p>
        {/* Ta sama strona: kliknięcie w odnośnik do bieżącego adresu przeładowuje loader, czyli
            pyta BE jeszcze raz. `.` rozwiązuje się do ścieżki trasy razem z tokenem. */}
        <Link to="." className="btn btn-primary btn-lg">
          Spróbuj ponownie
        </Link>
      </Karta>
    );
  }

  // Zostaje stan „formularz”. Odmowa „link-invalid” w akcji znaczy, że link zużył się albo wygasł
  // między podglądem a wysłaniem — wtedy do komunikatu dochodzi droga po nowy.
  const linkNieWazny = wynik && "odmowa" in wynik && wynik.odmowa === "link-invalid";
  return (
    <Karta>
      <h1 style={{ fontSize: 22, marginBottom: 18 }}>Dokończ rejestrację</h1>
      <Form method="post" style={{ display: "grid", gap: 14 }}>
        <div className="field">
          <label htmlFor="dok-email">Email</label>
          {/* Adres z linku. Akcja go nie czyta — BE bierze go z tokenu, nie z formularza. */}
          <input
            id="dok-email"
            name="email"
            type="email"
            value={dane.email}
            readOnly
            autoComplete="email"
            className="input"
            style={{ background: "var(--surface-2)", color: "var(--muted)" }}
          />
          <div className="text-xs muted" style={{ marginTop: 4 }}>
            Adres z linku — nie da się go tu zmienić.
          </div>
        </div>
        <div className="field">
          <label htmlFor="dok-name">Nazwa wyświetlana</label>
          <input
            id="dok-name"
            name="displayName"
            type="text"
            required
            maxLength={200}
            className="input"
          />
        </div>
        <div className="field">
          <label htmlFor="dok-password">Hasło (min. 8 znaków)</label>
          <input
            id="dok-password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="input"
          />
        </div>
        {dane.zgody.map((z) => (
          // Klucz niesie numer wersji: po `consents-changed` loader oddaje nową wersję, a nowy klucz
          // montuje pole od nowa — odznaczone. Zaznaczenie nie przechodzi na dokument, którego
          // człowiek nie widział.
          <label
            key={`${z.key}:${z.versionNumber}`}
            style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14 }}
          >
            <input
              type="checkbox"
              name="zgoda"
              value={`${z.key}:${z.versionNumber}`}
              required
              style={{ marginTop: 3 }}
            />
            <span>
              Akceptuję: {z.title} (
              {/* `noreferrer`, nie samo `noopener` (reguła `noBlankTarget` w Biome): adres tej strony
                  niesie token, a odnośnik do dokumentu nie ma go dostać w `Referer`. `aria-label`
                  zaczyna się od widocznego tekstu (WCAG 2.5.3, „Label in Name”), wskazuje dokument
                  i uprzedza o nowej karcie — bez niego lista odnośników w czytniku ekranu to samo
                  „przeczytaj” przy każdej zgodzie. */}
              <a
                href={`/dokumenty/${z.key}/${z.versionNumber}`}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`przeczytaj: ${z.title} (otwiera się w nowej karcie)`}
              >
                przeczytaj
              </a>
              )
            </span>
          </label>
        ))}
        {wynik && "blad" in wynik && (
          <p role="alert" style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>
            {wynik.blad} {linkNieWazny && <Link to="/rejestracja">Wyślij nowy link</Link>}
          </p>
        )}
        <button
          type="submit"
          className="btn btn-primary btn-lg"
          style={{ marginTop: 4 }}
          disabled={busy}
        >
          Załóż konto
        </button>
      </Form>
    </Karta>
  );
}
