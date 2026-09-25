import type { CalendarConnectionView, CalendarSyncFailureView } from "@kalisthenos/api-client";
import {
  type ActionFunctionArgs,
  Form,
  type LoaderFunctionArgs,
  redirect,
  useActionData,
  useLoaderData,
  useSearchParams,
} from "react-router";
import { requireUser } from "~/lib/api/auth";
import { ApiError, toRouteResponse } from "~/lib/api/errors";
import {
  calendarConnectionCopy,
  disconnectCalendar,
  getCalendarConnection,
  listCalendarSyncFailures,
  retryCalendarSyncFailure,
  startCalendarAuthorization,
  syncFailureKindCopy,
  syncFailuresNotice,
} from "~/lib/calendar";
import { fmtDateTime } from "~/lib/format";

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  // Równolegle, bo to dwa niezależne odczyty. Lista zaległości NIE zależy od
  // stanu połączenia — czyta outbox po trenerze — więc trener rozłączony wciąż
  // musi zobaczyć, co po sobie zostawił.
  const [connection, syncFailures] = await Promise.all([
    getCalendarConnection(api),
    listCalendarSyncFailures(api),
  ]);
  return { connection, syncFailures };
}

export async function action(args: ActionFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const fd = await args.request.formData();
  const intent = fd.get("intent");

  try {
    if (intent === "connect") {
      const { url, setCookie } = await startCalendarAuthorization(api);
      // `Headers.append`, nie literał obiektu: ciastek bywa więcej niż jedno,
      // a obiekt zostawiłby ostatnie. To ciastko wiąże zgodę z przeglądarką —
      // zgubione znaczy odmowę przy powrocie od dostawcy.
      const headers = new Headers();
      for (const cookie of setCookie) headers.append("Set-Cookie", cookie);
      return redirect(url, { headers });
    }
    if (intent === "disconnect") {
      await disconnectCalendar(api);
      return { success: "Konto Google odłączone." };
    }
    if (intent === "retry") {
      const id = fd.get("id");
      if (typeof id !== "string" || id === "") return { error: "Brak wskazania zaległości." };
      await retryCalendarSyncFailure(api, id);
      // Świadomie NIE „gotowe". Kontrakt oddaje `204`, bo dostarczenie jest
      // asynchroniczne — pozycja znika z listy, bo wróciła do kolejki, a nie
      // dlatego, że kalendarz już ją przyjął. Gdy się znów nie uda, wróci.
      return { success: "Ponowienie przyjęte. Jeśli znów się nie uda, wpis wróci na tę listę." };
    }
    return null;
  } catch (e) {
    // `409` to wyłączona integracja na serwerze. `message` z kontraktu jest
    // już po polsku i dla użytkownika, więc idzie na ekran bez tłumaczenia —
    // a granica błędu pokazałaby zamiast tego zupełnie inny ekran.
    if (e instanceof ApiError && e.status === 409) return { error: e.message };
    // `404` przy ponowieniu znaczy „tej zaległości już nie ma na liście":
    // ktoś kliknął dwa razy albo lista jest nieodświeżona. To nie jest awaria
    // ekranu — granica błędu wyrzuciłaby trenera z widoku za podwójne
    // kliknięcie, a wystarczy powiedzieć mu, co się stało.
    if (e instanceof ApiError && e.status === 404 && intent === "retry") {
      return { error: "Tej zaległości już nie ma na liście — odśwież widok." };
    }
    if (e instanceof ApiError) throw toRouteResponse(e);
    throw e;
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  denied: "Anulowałeś autoryzację lub odmówiłeś dostępu.",
  state: "Żądanie wygasło lub zostało zmodyfikowane — spróbuj ponownie.",
  exchange: "Nie udało się wymienić kodu autoryzacji na tokeny — spróbuj ponownie.",
};

export default function IntegracjeGoogle() {
  const { connection, syncFailures } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();

  // Nazwy parametrów pochodzą od BE (`callbackRedirect`), nie od FE.
  const calendarParam = searchParams.get("calendar");
  const okParam = calendarParam === "ok";
  const errorParam = calendarParam === "error" ? searchParams.get("reason") : null;

  // TRZY stany kontraktu, nie dwa. Do D-FE-2 stało tu `status !==
  // "disconnected"`, przez co `broken` wyglądał identycznie jak `connected`
  // i trener czytał „Połączone konto", gdy nic się nie synchronizowało.
  // Reguła mieszka w module, bo tylko tam da się jej dowieść testem.
  const stan = calendarConnectionCopy(connection.status);

  return (
    <div>
      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Trener
          </div>
          <h1>Integracje</h1>
          <div className="sub">
            Połącz konto Google, aby synchronizować konsultacje z kalendarzem.
          </div>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        {/* Banery z URL search params (po przekierowaniu z callbacku) */}
        {okParam && (
          <div className="alert alert-success" style={{ marginBottom: 16 }}>
            Konto Google zostało pomyślnie połączone.
          </div>
        )}
        {errorParam && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            {ERROR_MESSAGES[errorParam] ?? "Wystąpił nieoczekiwany błąd — spróbuj ponownie."}
          </div>
        )}

        {/* Baner z wyniku akcji (rozłącz / błąd serwera) */}
        {"success" in (actionData ?? {}) && actionData && "success" in actionData && (
          <div className="alert alert-success" style={{ marginBottom: 16 }}>
            {(actionData as { success: string }).success}
          </div>
        )}
        {"error" in (actionData ?? {}) && actionData && "error" in actionData && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            {(actionData as { error: string }).error}
          </div>
        )}

        <h2 style={{ fontSize: 17, margin: "0 0 12px" }}>Google Calendar</h2>

        {stan.ostrzezenie && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            {stan.ostrzezenie}
          </div>
        )}

        {stan.pokazKonto ? (
          <p style={{ margin: "0 0 16px" }}>
            Połączone konto: <strong>{connection.accountLabel ?? "(połączone)"}</strong>
          </p>
        ) : (
          <p className="muted" style={{ margin: "0 0 16px" }}>
            Brak połączonego konta Google. Kliknij poniżej, aby autoryzować dostęp do kalendarza.
          </p>
        )}

        <div className="row" style={{ gap: 8 }}>
          {/* Zgoda: przy `broken` jako „ponownie", przy braku konta jako pierwsza. */}
          {(stan.polaczOdNowa || !stan.pokazKonto) && (
            <Form method="post">
              <input type="hidden" name="intent" value="connect" />
              <button type="submit" className="btn btn-primary">
                {stan.polaczOdNowa ? "Połącz ponownie" : "Połącz z Google"}
              </button>
            </Form>
          )}
          {stan.mozliwoscRozlaczenia && (
            <Form method="post">
              <input type="hidden" name="intent" value="disconnect" />
              <button type="submit" className="btn btn-ghost" style={{ color: "var(--danger)" }}>
                Rozłącz
              </button>
            </Form>
          )}
        </div>
      </div>

      <SekcjaZaleglosci status={connection.status} pozycje={syncFailures} />
    </div>
  );
}

/**
 * Zaległości synchronizacji — D-26.
 *
 * Do 2026-09-24 zdarzenie terminu, którego nie udało się dostarczyć do
 * kalendarza, kończyło się **linijką w logu workera** i niczym więcej. Żaden
 * ekran o tym nie mówił, a `GET /v1/calendar/connection` pokazywał przy tym
 * `connected` — i słusznie, bo połączenie było zdrowe; zawiodło pojedyncze
 * zdarzenie. Skutek widziała dopiero podopieczna, przychodząc na spotkanie
 * odwołane tydzień wcześniej.
 *
 * **Odbiorcą jest trener** — jedyna osoba, która ma co z tym zrobić.
 *
 * **Stan pusty mówi wprost, że jest pusty, i to jest decyzja.** Sekcja, która
 * przy zerze znika bez śladu, nie odróżnia „sprawdziliśmy, nic nie ma" od
 * „nikt nie sprawdzał" — a domykamy tu defekt, którego objawem była dokładnie
 * ta nierozróżnialność.
 */
function SekcjaZaleglosci({
  status,
  pozycje,
}: {
  status: CalendarConnectionView["status"];
  pozycje: CalendarSyncFailureView[];
}) {
  const uwaga = syncFailuresNotice(status, pozycje.length);

  return (
    <div className="card" style={{ maxWidth: 560, marginTop: 16 }}>
      <h2 style={{ fontSize: 17, margin: "0 0 12px" }}>
        Zaległości synchronizacji
        {pozycje.length > 0 && ` (${pozycje.length})`}
      </h2>

      {pozycje.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Brak zaległości — wszystko, co zmieniałeś, trafiło do kalendarza.
        </p>
      ) : (
        <>
          <p className="muted" style={{ margin: "0 0 12px" }}>
            Tych zmian system nie zdołał wykonać w Twoim kalendarzu mimo dziesięciu prób. Ponów albo
            popraw wpis ręcznie w Google.
          </p>

          {uwaga && (
            <div className="alert alert-error" style={{ marginBottom: 12 }}>
              {uwaga}
            </div>
          )}

          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {pozycje.map((p) => (
              <li
                key={p.id}
                className="row"
                style={{
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "10px 0",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div>
                  <div style={{ fontSize: 14 }}>Nie udało się {syncFailureKindCopy(p.kind)}.</div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                    Spotkanie {fmtDateTime(p.scheduledAt)}
                    {" · "}
                    {/* `null` znaczy „podopiecznego już nie da się ustalić" —
                        cisza w tym miejscu czytałaby się jak brak podopiecznego
                        w ogóle, a trener szuka po niej wpisu w Google. */}
                    {p.traineeName ?? "podopieczny nieustalony"}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    Nie udaje się od {fmtDateTime(p.failedAt)}
                  </div>
                </div>

                <Form method="post">
                  <input type="hidden" name="intent" value="retry" />
                  <input type="hidden" name="id" value={p.id} />
                  <button type="submit" className="btn btn-ghost">
                    Ponów
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
