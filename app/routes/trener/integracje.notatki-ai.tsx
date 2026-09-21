import {
  type ActionFunctionArgs,
  Form,
  Link,
  type LoaderFunctionArgs,
  useActionData,
  useLoaderData,
} from "react-router";
import { requireUser } from "~/lib/api/auth";
import { ApiError, toRouteResponse } from "~/lib/api/errors";
import { getCalendarConnection } from "~/lib/calendar";
import { disableNotetaker, enableNotetaker, getNotetakerStatus } from "~/lib/notetaker";

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  // Dwa niezależne odczyty: `NotetakerIntegrationView` niesie WYŁĄCZNIE `enabled`
  // (Zadanie 14) — nic o kalendarzu — a to, czy WOLNO włączyć integrację, zależy
  // od stanu połączenia. Trasa dociąga je osobno, tak jak zakłada rozstrzygnięcie
  // sprzed tego zadania.
  const [notetaker, calendar] = await Promise.all([
    getNotetakerStatus(api),
    getCalendarConnection(api),
  ]);
  return { notetaker, calendar };
}

export async function action(args: ActionFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const fd = await args.request.formData();
  const intent = fd.get("intent");

  try {
    if (intent === "enable") {
      await enableNotetaker(api);
      return { success: "Notatki AI włączone." };
    }
    if (intent === "disable") {
      await disableNotetaker(api);
      return { success: "Notatki AI wyłączone." };
    }
    return null;
  } catch (e) {
    // `409 NOTETAKER_REQUIRES_CALENDAR` — FE wyszarza przełącznik, gdy loader
    // widzi kalendarz niegotowy, ale to BE jest tu autorytetem: sprawdzenie
    // i zapis stoją po jego stronie w JEDNEJ transakcji właśnie po to, żeby
    // zamknąć okno między wczytaniem ekranu a kliknięciem — kalendarz mógł
    // zniknąć w międzyczasie. `app/lib/notetaker.ts` celowo NIE mapuje tego
    // wyjątku („wywołujący czyta error.code"), więc kod czytamy tutaj, nie
    // sam status. `message` z kontraktu jest już po polsku i dla użytkownika,
    // więc idzie na ekran bez tłumaczenia — wzorem `integracje.google.tsx`.
    if (e instanceof ApiError && e.code === "NOTETAKER_REQUIRES_CALENDAR") {
      return { error: e.message };
    }
    if (e instanceof ApiError) throw toRouteResponse(e);
    throw e;
  }
}

/**
 * Dwa różne wyjaśnienia, nie jedno: „nie masz kalendarza" i „twój kalendarz
 * przestał działać" to dla trenera dwa różne problemy i dwie różne czynności
 * naprawcze (rozstrzygnięcie sprzed tego zadania). `connected` nie ma tu wpisu,
 * bo wtedy przełącznik nic nie blokuje.
 */
const CALENDAR_BLOCK_MESSAGES: Record<"disconnected" | "broken", string> = {
  disconnected: "Najpierw podłącz kalendarz Google — bez niego bot nie ma dokąd dołączyć.",
  broken: "Połączenie z kalendarzem Google przestało działać. Odnów je, aby włączyć notatki AI.",
};

export default function IntegracjeNotatkiAi() {
  const { notetaker, calendar } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const { status } = calendar;
  const calendarBlocked = status === "disconnected" || status === "broken" ? status : null;
  const canEnable = status === "connected";

  return (
    <div>
      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Trener
          </div>
          <h1>Integracje</h1>
          <div className="sub">
            Automatyczne notatki z konsultacji, przygotowane przez asystenta AI po spotkaniu.
          </div>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        {"success" in (actionData ?? {}) && actionData && "success" in actionData && (
          <div className="alert alert-ok" style={{ marginBottom: 16 }}>
            {(actionData as { success: string }).success}
          </div>
        )}
        {"error" in (actionData ?? {}) && actionData && "error" in actionData && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            {(actionData as { error: string }).error}
          </div>
        )}

        <h2 style={{ fontSize: 17, margin: "0 0 12px" }}>Notatki AI</h2>

        {notetaker.enabled ? (
          <div>
            <p style={{ margin: "0 0 16px" }}>
              Notatki AI są <strong>włączone</strong>. Bot dołączy do spotkań z linkiem
              w kalendarzu i przygotuje notatkę z ich przebiegu.
            </p>
            <Form method="post">
              <input type="hidden" name="intent" value="disable" />
              <button type="submit" className="btn btn-ghost" style={{ color: "var(--danger)" }}>
                Wyłącz
              </button>
            </Form>
          </div>
        ) : (
          <div>
            <p className="muted" style={{ margin: "0 0 16px" }}>
              Notatki AI są wyłączone. Po włączeniu bot dołączy do spotkań z linkiem w kalendarzu
              i przygotuje notatkę z ich przebiegu.
            </p>

            {calendarBlocked && (
              <div className="alert alert-error" style={{ marginBottom: 16 }}>
                {CALENDAR_BLOCK_MESSAGES[calendarBlocked]}{" "}
                <Link to="/trener/integracje/google">Przejdź do integracji Google</Link>.
              </div>
            )}

            <Form method="post">
              <input type="hidden" name="intent" value="enable" />
              <button type="submit" className="btn btn-primary" disabled={!canEnable}>
                Włącz
              </button>
            </Form>
          </div>
        )}
      </div>
    </div>
  );
}
