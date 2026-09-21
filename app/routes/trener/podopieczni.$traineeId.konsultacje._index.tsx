import {
  type ActionFunctionArgs,
  Form,
  Link,
  type LoaderFunctionArgs,
  useActionData,
  useLoaderData,
} from "react-router";
import { ConfirmSubmitButton } from "~/components/confirm-provider";
import { ConsultationAlert } from "~/components/consultation-alert";
import { ConsultationRow } from "~/components/consultation-row";
import { Icons } from "~/components/icons";
import { ScheduleForm } from "~/components/schedule-form";
import { requireUser } from "~/lib/api/auth";
import { ApiError, toRouteResponse } from "~/lib/api/errors";
import { getCalendarConnection } from "~/lib/calendar";
import { parseScheduleFormData } from "~/lib/consultation-form.server";
import {
  type ConsultationCadence,
  ScheduleError,
  deactivateSchedule,
  defaultTitle,
  getActiveSchedule,
  upsertSchedule,
} from "~/lib/consultation-schedules";
import { presentationFor } from "~/lib/consultation-status";
import { ScheduleFormSchema } from "~/lib/consultation-types";
import {
  ConsultationError,
  appWallClockNow,
  listOccurrencesForTrainer,
  runConsultationSync,
} from "~/lib/consultations";
import { fmtDateTime, todayISO } from "~/lib/format";
import { findTraineeRef } from "~/lib/trainees";

const CADENCE_LABEL: Record<ConsultationCadence, string> = {
  weekly: "co tydzień",
  biweekly: "co 2 tygodnie",
  monthly: "co miesiąc",
};

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const traineeId = args.params.traineeId ?? "";
  // Nazwa do nagłówka i `404` dla cudzego podopiecznego. Z listy terminów jej
  // wziąć nie można — para bez ani jednego terminu daje pustą listę, a nagłówek
  // ma się wtedy wyrenderować tak samo (luka L S5-2).
  const trainee = await findTraineeRef(api, traineeId);
  if (!trainee) throw new Response("not found", { status: 404 });

  // Materializacji terminów nikt już stąd nie wywołuje: siatkę utrzymuje BE
  // (zapis harmonogramu plus praca cykliczna workera), więc dawne
  // `ensureOccurrences` zniknęło razem z horyzontem po stronie FE.
  const schedule = await getActiveSchedule(api, traineeId);
  const occurrences = await listOccurrencesForTrainer(api, traineeId, {
    nowISO: new Date().toISOString(),
  });
  // `broken` liczy się jako aktywne, tak samo jak przed integracją, gdzie
  // decydowała sama obecność wiersza połączenia. Chip zostaje widoczny,
  // a o tym, czy synchronizacja przejdzie, rozstrzyga `runConsultationSync`
  // (`connected: false` → komunikat zamiast mylącego „0/0").
  const googleActive = (await getCalendarConnection(api)).status !== "disconnected";
  return { trainee, schedule, occurrences, googleActive };
}

export async function action(args: ActionFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const traineeId = args.params.traineeId ?? "";
  const fd = await args.request.formData();
  const intent = fd.get("intent");
  try {
    if (intent === "deactivate-schedule") {
      // Odwołanie przyszłych niepotwierdzonych terminów i zdjęcie ich zdarzeń
      // z kalendarza zewnętrznego robi BE — dawne `syncCancelStaleSchedule`
      // zniknęło stąd bez zamiennika.
      await deactivateSchedule(api, traineeId);
      return { success: "Harmonogram wyłączony." };
    }
    if (intent === "save-schedule") {
      const parsed = ScheduleFormSchema.safeParse(parseScheduleFormData(fd));
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Niepoprawne dane." };
      // Zapis jest różnicowy po stronie BE: bez zmian nie rusza niczego,
      // a zmieniona reguła sama odtwarza siatkę i wypycha ją do kalendarza
      // przez outbox. Stąd komunikat bez liczby zsynchronizowanych terminów —
      // synchronizacja nie dzieje się już w tym żądaniu.
      await upsertSchedule(api, { traineeId, form: parsed.data });
      return { success: "Harmonogram zapisany." };
    }
    if (intent === "sync-google") {
      const r = await runConsultationSync(api, traineeId);
      // Bez tego „0/0" wyglądałoby jak sukces także wtedy, gdy połączenia nie ma
      // albo jest martwe (np. cofnięta zgoda w Google) — a wtedy nic się nie
      // synchronizuje po cichu. Wyłączona integracja odpowiada tym samym.
      if (!r.connected) {
        return {
          error: "Nie udało się połączyć z kontem Google. Sprawdź integrację w ustawieniach.",
        };
      }
      return {
        success: r.attempted
          ? `Zsynchronizowano: ${r.synced}/${r.attempted}.`
          : "Brak terminów do synchronizacji.",
      };
    }
    return null;
  } catch (e) {
    if (e instanceof ScheduleError || e instanceof ConsultationError) {
      return { error: e.userMessage };
    }
    if (e instanceof ApiError) throw toRouteResponse(e);
    throw e;
  }
}

export default function TrenerKonsultacjeIndex() {
  const { trainee, schedule, occurrences, googleActive } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  // Czas ścienny, nie moment — `scheduledAt` jest w tej samej konwencji (D-FE-3).
  const now = appWallClockNow();

  const upcoming = occurrences.filter(
    (o) =>
      o.status !== "documented" &&
      o.status !== "cancelled" &&
      new Date(o.scheduledAt).getTime() >= now,
  );
  const past = occurrences.filter(
    (o) =>
      o.status === "documented" ||
      (o.status !== "cancelled" && new Date(o.scheduledAt).getTime() < now),
  );
  // Najnowsze pozycje minione na górze.
  past.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

  const listUrl = `/trener/podopieczni/${trainee.id}/konsultacje`;

  function rows(items: typeof occurrences) {
    return (
      <div className="list">
        {items.map((o) => {
          const meta = presentationFor(o.presentation);
          return (
            <ConsultationRow
              key={o.id}
              to={`${listUrl}/${o.id}`}
              lead={fmtDateTime(o.scheduledAt)}
              // Kontrakt nie niesie tytułu (`title` nie istnieje w `/v1`) —
              // nagłówek liczy się z terminu, tak samo po obu stronach.
              title={defaultTitle(o.scheduledAt)}
              label={meta.label}
              tone={meta.tone}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <div className="crumbs">
        <Link to="/trener/podopieczni">Podopieczni</Link>
        <span className="sep">›</span>
        <Link to={`/trener/podopieczni/${trainee.id}`}>{trainee.displayName}</Link>
        <span className="sep">›</span>
        <span className="current">Konsultacje</span>
      </div>

      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            {trainee.displayName}
          </div>
          <h1>Konsultacje</h1>
          <div className="sub">
            {schedule
              ? `Harmonogram: ${CADENCE_LABEL[schedule.cadence]} · ${schedule.timeOfDay.slice(0, 5)}`
              : "Brak aktywnego harmonogramu."}
          </div>
        </div>
        <Link to={`${listUrl}/nowa`} className="btn btn-primary">
          <Icons.Plus /> Nowy termin
        </Link>
      </div>

      <ConsultationAlert data={actionData} />

      {/* Panel harmonogramu */}
      <div className="card" style={{ marginBottom: 22, maxWidth: 760 }}>
        <div className="row between" style={{ alignItems: "center", marginBottom: 16 }}>
          <div className="row" style={{ alignItems: "center", gap: 12 }}>
            <h2 style={{ fontSize: 17, margin: 0 }}>
              <Icons.Calendar style={{ marginRight: 8, color: "var(--muted)" }} />
              Harmonogram cykliczny
            </h2>
            {googleActive && (
              <span className="badge" style={{ fontSize: 11 }}>
                Google: połączony
              </span>
            )}
          </div>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            {googleActive && (
              <Form method="post">
                <input type="hidden" name="intent" value="sync-google" />
                <ConfirmSubmitButton
                  className="btn btn-sm btn-ghost"
                  confirmOptions={{
                    title: "Zsynchronizować z Google?",
                    message:
                      "Nadchodzące terminy trafią do kalendarza, a te już wysłane zostaną wyrównane do godzin z aplikacji. Google powiadomi podopiecznego mailem o zaproszeniach i zmianach godziny.",
                    confirmText: "Synchronizuj",
                  }}
                >
                  Synchronizuj z Google
                </ConfirmSubmitButton>
              </Form>
            )}
            {schedule && (
              <Form method="post">
                <input type="hidden" name="intent" value="deactivate-schedule" />
                <ConfirmSubmitButton
                  className="btn btn-sm btn-ghost"
                  style={{ color: "var(--danger)" }}
                  confirmOptions={{
                    title: "Wyłączyć harmonogram?",
                    message:
                      "Generowanie nowych terminów zatrzyma się, a przyszłe niepotwierdzone terminy zostaną odwołane. Potwierdzone i udokumentowane zostają.",
                    destructive: true,
                    confirmText: "Wyłącz harmonogram",
                  }}
                >
                  Wyłącz
                </ConfirmSubmitButton>
              </Form>
            )}
          </div>
        </div>
        <Form method="post">
          <input type="hidden" name="intent" value="save-schedule" />
          <ScheduleForm
            defaultStartsOn={todayISO()}
            defaultValue={
              schedule
                ? {
                    cadence: schedule.cadence,
                    weekday: schedule.weekday,
                    dayOfMonth: schedule.dayOfMonth,
                    timeOfDay: schedule.timeOfDay,
                    durationMin: schedule.durationMin,
                    startsOn: schedule.startsOn,
                    defaultMeetingUrl: schedule.defaultMeetingUrl,
                  }
                : null
            }
          />
          <div
            style={{
              marginTop: 20,
              paddingTop: 16,
              borderTop: "1px solid var(--line)",
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <button type="submit" className="btn btn-primary">
              {schedule ? "Zaktualizuj harmonogram" : "Zapisz harmonogram"}
            </button>
          </div>
        </Form>
      </div>

      {/* Nadchodzące terminy */}
      <div style={{ maxWidth: 760 }}>
        <h2 style={{ fontSize: 17, margin: "0 0 12px" }}>Nadchodzące terminy</h2>
        {upcoming.length === 0 ? (
          <div className="empty">
            <h3>Brak nadchodzących terminów</h3>
            <div>Ustaw harmonogram powyżej albo dodaj pojedynczy termin.</div>
          </div>
        ) : (
          rows(upcoming)
        )}

        {/* Do udokumentowania / minione */}
        <h2 style={{ fontSize: 17, margin: "28px 0 12px" }}>Do udokumentowania / minione</h2>
        {past.length === 0 ? (
          <div className="empty">
            <h3>Brak minionych terminów</h3>
            <div>Tu pojawią się terminy po ich dacie oraz udokumentowane spotkania.</div>
          </div>
        ) : (
          rows(past)
        )}
      </div>
    </div>
  );
}
