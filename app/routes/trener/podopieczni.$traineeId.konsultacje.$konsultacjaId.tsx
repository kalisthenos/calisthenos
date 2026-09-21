import {
  Form,
  Link,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  redirect,
  useActionData,
  useLoaderData,
  useSearchParams,
} from "react-router";
import { AiNotesPanel } from "~/components/ai-notes-panel";
import { ConfirmSubmitButton } from "~/components/confirm-provider";
import { ConsultationAlert } from "~/components/consultation-alert";
import { ConsultationForm } from "~/components/consultation-form";
import { StatusBadge } from "~/components/consultation-status-badge";
import { Icons } from "~/components/icons";
import { requireUser } from "~/lib/api/auth";
import { ApiError, toRouteResponse } from "~/lib/api/errors";
import { defaultTitle } from "~/lib/consultation-schedules";
import { consultationPresentation } from "~/lib/consultation-status";
import { parseConsultationDocFormData } from "~/lib/consultation-form.server";
import { ConsultationDocFormSchema } from "~/lib/consultation-types";
import {
  ConsultationError,
  cancelOccurrence,
  deleteConsultation,
  documentConsultation,
  getConsultationDetail,
  rescheduleOccurrence,
  setActionItemStatus,
} from "~/lib/consultations";
import { fmtDate, fmtDateTime } from "~/lib/format";

/** ISO (UTC) → wartość dla <input type="datetime-local"> ("YYYY-MM-DDTHH:MM"). */
function toLocalInput(iso: string): string {
  return iso.slice(0, 16);
}

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const traineeId = args.params.traineeId ?? "";
  // Zakres tenanta rozstrzyga BE (cudzy termin to `404`), ale zgodność ze
  // ścieżką — już nie: adres wskazujący termin INNEGO podopiecznego tego
  // samego trenera przeszedłby i wyrenderował się pod złym nazwiskiem.
  // Dlatego porównanie zostaje tutaj, jak przed integracją.
  const detail = await getConsultationDetail(api, args.params.konsultacjaId ?? "");
  if (!detail || detail.trainee.id !== traineeId) {
    throw new Response("not found", { status: 404 });
  }
  // JEDYNA z dziewięciu tras trenera, która nazwy nie musi dopytywać: niesie ją
  // widok, po który ta trasa i tak sięga (`ConsultationView.trainee`) — patrz
  // luka L S5-2. Porównanie wyżej gwarantuje, że to nazwa podopiecznego ze ścieżki.
  return { detail, traineeId, traineeName: detail.trainee.displayName };
}

export async function action(args: ActionFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const traineeId = args.params.traineeId ?? "";
  const consultationId = args.params.konsultacjaId ?? "";
  const fd = await args.request.formData();
  const intent = fd.get("intent");
  try {
    // Wiązanie do ścieżki traineeId (mislinked URL → 404), jak w loaderze:
    // BE odmawia dostępu do CUDZEGO terminu, ale termin innego podopiecznego
    // tego samego trenera przepuści. Jedno `GET` przed mutacją, tak jak przed
    // integracją było jedno zapytanie.
    if (
      intent === "delete" ||
      intent === "document" ||
      intent === "reschedule" ||
      intent === "cancel"
    ) {
      const owned = await getConsultationDetail(api, consultationId);
      if (!owned || owned.trainee.id !== traineeId) {
        throw new Response("not found", { status: 404 });
      }
    }
    // Zdarzenia w kalendarzu zewnętrznym zdejmuje i wypycha BE przez outbox po
    // każdej z tych mutacji — dawne `syncCancelOne`/`syncUpsertOne` zniknęły
    // stąd bez zamiennika.
    if (intent === "delete") {
      await deleteConsultation(api, consultationId);
      throw redirect(`/trener/podopieczni/${traineeId}/konsultacje`);
    }
    if (intent === "cancel") {
      await cancelOccurrence(api, consultationId);
      return { success: "Termin odwołany." };
    }
    if (intent === "reschedule") {
      const scheduledAtLocal = String(fd.get("scheduledAt") ?? "");
      const durationMin = Number(fd.get("durationMin") ?? "") || undefined;
      await rescheduleOccurrence(api, { consultationId, scheduledAtLocal, durationMin });
      return { success: "Termin przełożony." };
    }
    if (intent === "toggle-item") {
      const itemId = String(fd.get("itemId") ?? "");
      const status = fd.get("status") === "resolved" ? "resolved" : "open";
      // Punkt adresuje się przez termin: kontrakt ma go w ścieżce
      // (`/v1/consultations/{id}/action-items/{itemId}`), więc samo `itemId`
      // już nie wystarcza.
      await setActionItemStatus(api, { consultationId, itemId, status });
      return null;
    }
    if (intent === "document") {
      const parsed = ConsultationDocFormSchema.safeParse(parseConsultationDocFormData(fd));
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Niepoprawne dane." };
      await documentConsultation(api, { consultationId, form: parsed.data });
      return { success: "Zapisano." };
    }
    return null;
  } catch (e) {
    if (e instanceof Response) throw e;
    if (e instanceof ConsultationError) return { error: e.userMessage };
    if (e instanceof ApiError) throw toRouteResponse(e);
    throw e;
  }
}

export default function TrenerKonsultacjaDetail() {
  const { detail, traineeId, traineeName } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const isDocument = searchParams.get("document") === "1";

  // Szczegół z kontraktu jest PŁASKI: punkty siedzą w `actionItems`, a tytułu
  // nie ma wcale (`title` nie istnieje w `/v1`) — nagłówek liczy się z terminu.
  const c = detail;
  const items = c.actionItems;
  const title = defaultTitle(c.scheduledAt);
  const listUrl = `/trener/podopieczni/${traineeId}/konsultacje`;

  // ── DOCUMENT mode ──────────────────────────────────────────
  if (isDocument) {
    return (
      <div>
        <div className="crumbs">
          <Link to="/trener/podopieczni">Podopieczni</Link>
          <span className="sep">›</span>
          <Link to={`/trener/podopieczni/${traineeId}`}>{traineeName}</Link>
          <span className="sep">›</span>
          <Link to={listUrl}>Konsultacje</Link>
          <span className="sep">›</span>
          <Link to={`${listUrl}/${c.id}`}>{title}</Link>
          <span className="sep">›</span>
          <span className="current">Dokumentowanie</span>
        </div>

        <div className="pagehead">
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Termin · <span className="mono">{fmtDateTime(c.scheduledAt)}</span>
            </div>
            <h1>Udokumentuj spotkanie</h1>
          </div>
        </div>

        <ConsultationAlert data={actionData} />

        <div className="card" style={{ maxWidth: 760 }}>
          <Form method="post">
            <input type="hidden" name="intent" value="document" />
            <ConsultationForm
              defaultValue={{
                scheduledAt: toLocalInput(c.scheduledAt),
                durationMin: c.durationMin,
                meetingUrl: c.meetingUrl,
                // `periodFrom`/`periodTo` nie idą: kontrakt ich nie niesie
                // (kolumny są spadkiem po legacy, `docs/04` o nich milczy).
                title,
                summary: c.summary ?? "",
                items: items.map((it) => ({ body: it.body, status: it.status })),
              }}
            />
            <div
              style={{
                marginTop: 24,
                paddingTop: 18,
                borderTop: "1px solid var(--line)",
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
              }}
            >
              <Link to={`${listUrl}/${c.id}`} className="btn btn-ghost">
                Anuluj
              </Link>
              <button type="submit" className="btn btn-primary">
                Zapisz dokumentację
              </button>
            </div>
          </Form>
        </div>
      </div>
    );
  }

  // ── VIEW mode ──────────────────────────────────────────────
  const openCount = items.filter((it) => it.status === "open").length;
  const isCancelled = c.status === "cancelled";
  const isDocumented = c.status === "documented";
  const meta = consultationPresentation({
    status: c.status,
    scheduledAtISO: c.scheduledAt,
    nowMs: Date.now(),
    viewer: "trainer",
  });

  return (
    <div>
      <div className="crumbs">
        <Link to="/trener/podopieczni">Podopieczni</Link>
        <span className="sep">›</span>
        <Link to={`/trener/podopieczni/${traineeId}`}>{traineeName}</Link>
        <span className="sep">›</span>
        <Link to={listUrl}>Konsultacje</Link>
        <span className="sep">›</span>
        <span className="current">{title}</span>
      </div>

      <div className="pagehead">
        <div>
          <div
            className="eyebrow"
            style={{ marginBottom: 6, display: "flex", gap: 10, alignItems: "center" }}
          >
            <span className="mono">{fmtDateTime(c.scheduledAt)}</span>
            <span>· {c.durationMin} min</span>
            <StatusBadge label={meta.label} tone={meta.tone} />
          </div>
          <h1>{title}</h1>
          {c.meetingUrl && (
            <div className="sub" style={{ marginTop: 4 }}>
              <a
                href={c.meetingUrl}
                target="_blank"
                rel="noreferrer"
                className="row"
                style={{ gap: 6, display: "inline-flex", alignItems: "center" }}
              >
                <Icons.Video /> Link spotkania
              </a>
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {!isCancelled && (
            <Link to="?document=1" className="btn btn-primary">
              <Icons.Note /> {isDocumented ? "Edytuj dokumentację" : "Udokumentuj"}
            </Link>
          )}
          <Form method="post">
            <input type="hidden" name="intent" value="delete" />
            <ConfirmSubmitButton
              className="btn btn-icon btn-ghost"
              style={{ color: "var(--danger)" }}
              title="Usuń termin"
              aria-label="Usuń termin"
              confirmOptions={{
                title: "Usunąć termin?",
                message:
                  "Usunięcie jest nieodwracalne — przepada dokumentacja i punkty do poprawy.",
                destructive: true,
                confirmText: "Usuń termin",
              }}
            >
              <Icons.Trash />
            </ConfirmSubmitButton>
          </Form>
        </div>
      </div>

      <ConsultationAlert data={actionData} />

      {/* Notatka podopiecznego (prośba o zmianę) */}
      {c.status === "change_requested" && c.traineeNote && (
        <div
          className="card"
          style={{
            marginBottom: 18,
            maxWidth: 760,
            borderColor: "var(--warn)",
            borderStyle: "dashed",
          }}
        >
          <div className="field-label" style={{ marginBottom: 6, color: "var(--warn)" }}>
            Podopieczny prosi o zmianę terminu
          </div>
          <p
            style={{
              whiteSpace: "pre-wrap",
              fontSize: 14,
              lineHeight: 1.6,
              color: "var(--ink-2)",
              margin: 0,
            }}
          >
            {c.traineeNote}
          </p>
        </div>
      )}

      {/* Akcje terminu: przełóż / odwołaj */}
      {!isCancelled && !isDocumented && (
        <div className="card" style={{ marginBottom: 18, maxWidth: 760 }}>
          <div className="field-label" style={{ marginBottom: 10 }}>
            Zarządzaj terminem
          </div>
          <Form
            method="post"
            className="row"
            style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}
          >
            <input type="hidden" name="intent" value="reschedule" />
            <div className="field" style={{ flex: 1, minWidth: 220 }}>
              <label htmlFor="rs-scheduledAt">Nowy termin</label>
              <input
                id="rs-scheduledAt"
                className="input"
                type="datetime-local"
                name="scheduledAt"
                defaultValue={toLocalInput(c.scheduledAt)}
                required
              />
            </div>
            <div className="field" style={{ width: 140 }}>
              <label htmlFor="rs-durationMin">Czas (min)</label>
              <input
                id="rs-durationMin"
                className="input"
                type="number"
                name="durationMin"
                min={1}
                max={600}
                defaultValue={c.durationMin}
              />
            </div>
            <button type="submit" className="btn">
              <Icons.Calendar /> Przełóż
            </button>
          </Form>
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
            <Form method="post">
              <input type="hidden" name="intent" value="cancel" />
              <ConfirmSubmitButton
                className="btn btn-ghost btn-sm"
                style={{ color: "var(--danger)" }}
                confirmOptions={{
                  title: "Odwołać termin?",
                  message:
                    "Termin zostanie oznaczony jako odwołany i zniknie z kalendarza podopiecznego.",
                  destructive: true,
                  confirmText: "Odwołaj termin",
                }}
              >
                Odwołaj termin
              </ConfirmSubmitButton>
            </Form>
          </div>
        </div>
      )}

      {/*
        Notatka AI Notetakera — renderuje się BEZWARUNKOWO, niezależnie od
        `isDocumented`/`isCancelled`: to jest cały sens sześciu stanów
        `aiNotesState` (docs/04 §AI Notetaker) — trener ma się dowiedzieć
        DLACZEGO notatki nie ma, nie tylko że jej nie ma. Zagnieżdżenie pod
        warunkiem odtworzyłoby dokładnie tę ciszę, przed którą ma chronić.
      */}
      <AiNotesPanel state={c.aiNotesState} notes={c.aiNotes} />

      {/* Podsumowanie */}
      {c.summary && c.summary.trim().length > 0 && (
        <div className="card" style={{ marginBottom: 18, maxWidth: 760 }}>
          <div className="field-label" style={{ marginBottom: 10 }}>
            Podsumowanie
          </div>
          <p
            style={{
              whiteSpace: "pre-wrap",
              fontSize: 14,
              lineHeight: 1.6,
              color: "var(--ink-2)",
              margin: 0,
            }}
          >
            {c.summary}
          </p>
        </div>
      )}

      {/*
        „Okres omówiony" (`periodFrom`–`periodTo`) zniknął z ekranu: kontrakt
        tych pól nie niesie. Kolumny są w bazie spadkiem po aplikacji
        fullstackowej, a `docs/04` o nich milczy — BE świadomie ich nie
        wystawia, bo najpierw trzeba rozstrzygnąć, co właściwie znaczą.
        Luka L S3-3 w planie przepięcia.
      */}

      {/* Punkty do poprawy */}
      {items.length === 0 ? (
        isDocumented && (
          <div className="empty" style={{ maxWidth: 760 }}>
            <h3>Brak punktów</h3>
            <div>Ta konsultacja nie ma żadnych punktów do poprawy.</div>
          </div>
        )
      ) : (
        <div style={{ maxWidth: 760 }}>
          <div className="field-label" style={{ marginBottom: 10 }}>
            Do poprawy (
            {openCount > 0 ? `${openCount} otwartych z ${items.length}` : `${items.length}`})
          </div>
          <div className="list">
            {items.map((item) => {
              const resolved = item.status === "resolved";
              const nextStatus = resolved ? "open" : "resolved";
              return (
                <div
                  key={item.id}
                  className="list-row"
                  style={{
                    gridTemplateColumns: "24px 1fr auto",
                    gap: 14,
                    cursor: "default",
                    opacity: resolved ? 0.6 : 1,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center" }}>
                    {resolved ? (
                      <Icons.Check style={{ color: "var(--ok)", width: 16, height: 16 }} />
                    ) : (
                      <Icons.Dot style={{ color: "var(--warn)", width: 16, height: 16 }} />
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      textDecoration: resolved ? "line-through" : "none",
                      color: resolved ? "var(--muted)" : "var(--ink)",
                    }}
                  >
                    {item.body}
                  </div>
                  <Form method="post" style={{ display: "flex" }}>
                    <input type="hidden" name="intent" value="toggle-item" />
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="hidden" name="status" value={nextStatus} />
                    <button
                      type="submit"
                      className="btn btn-sm btn-ghost"
                      style={{
                        fontSize: 12,
                        color: resolved ? "var(--muted)" : "var(--ink-2)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {resolved ? "Cofnij do otwartych" : "Oznacz jako poprawione"}
                    </button>
                  </Form>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
