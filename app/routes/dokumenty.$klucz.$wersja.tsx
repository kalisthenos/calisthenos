import Markdown from "react-markdown";
import { type LoaderFunctionArgs, type MetaFunction, useLoaderData } from "react-router";
import { optionalUser } from "~/lib/api/auth";
import { consentDocument } from "~/lib/consent-documents";
import { APP_TIME_ZONE } from "~/lib/format";

// Strefa aplikacji jest stała i podana jawnie (`APP_TIME_ZONE`, ta sama co w `consultations.ts`):
// serwer i przeglądarka formatują wtedy tę samą datę tak samo, więc strona nie rozjeżdża się przy
// hydratacji, a „obowiązuje od” nie zależy od strefy hosta.
const DATA = new Intl.DateTimeFormat("pl-PL", { dateStyle: "long", timeZone: APP_TIME_ZONE });

/**
 * Strona publiczna i dla każdego (spec tras §9.3): zalogowany jej nie omija, więc `user` nie jest
 * tu czytany — inaczej niż w trasach rejestracji, które odsyłają go do jego sekcji.
 *
 * Wszystko, co nie jest dokumentem, kończy się `404`: numer wersji, który nie jest dodatnią liczbą
 * całkowitą, nie kosztuje wywołania BE, a nieznany klucz i nieznany numer są nieodróżnialne (moduł
 * zamienia oba `404` z BE na `null`). Awaria BE — także `429` z limitu `default` — leci dalej do
 * granicy błędu: komunikat limitu ze specu §9.2 dotyczy ekranów rejestracji, nie tej strony.
 */
export async function loader(args: LoaderFunctionArgs) {
  const { api } = optionalUser(args.context);
  const wersja = Number(args.params.wersja);
  if (!Number.isInteger(wersja) || wersja < 1) throw new Response("not found", { status: 404 });
  const dokument = await consentDocument(api, args.params.klucz ?? "", wersja);
  if (!dokument) throw new Response("not found", { status: 404 });
  return dokument;
}

/**
 * Tytuł karty to tytuł dokumentu z nazwą marki, tak jak w `rejestracja.$token.tsx`. Bez dokumentu
 * (loader rzucił `404`) nie ma czego podpisać — trasa tytułu nie dokłada.
 */
export const meta: MetaFunction<typeof loader> = ({ loaderData }) =>
  loaderData ? [{ title: `${loaderData.title} — kalisthenos` }] : [];

/**
 * Treść dokumentu prawnego w wersji (spec tras §8) — do przeczytania przed akceptacją, zapisania
 * i wydruku. `react-markdown` buduje elementy Reacta i surowego HTML nie przepuszcza. Klasa
 * `dokument-tresc` (`app/styles/tokens.css`) daje treści minimalną typografię: katalog zgód
 * dostarcza sam Markdown, bez własnych styli.
 */
export default function Dokument() {
  const d = useLoaderData<typeof loader>();
  return (
    <main className="auth-shell">
      <article className="auth-card" style={{ maxWidth: 760 }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Wersja {d.versionNumber} · obowiązuje od {DATA.format(new Date(d.effectiveFrom))}
        </div>
        <h1 style={{ fontSize: 22, marginBottom: 18 }}>{d.title}</h1>
        <div className="dokument-tresc">
          <Markdown>{d.content}</Markdown>
        </div>
      </article>
    </main>
  );
}
