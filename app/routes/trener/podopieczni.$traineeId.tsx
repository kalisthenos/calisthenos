import {
  type ActionFunctionArgs,
  Form,
  Link,
  type LoaderFunctionArgs,
  redirect,
  useActionData,
  useLoaderData,
} from "react-router";
import { ConfirmSubmitButton } from "~/components/confirm-provider";
import { Icons } from "~/components/icons";
import { ListControls } from "~/components/list-controls";
import { Pagination, parsePage } from "~/components/pagination";
import {
  CoverageCard,
  HealthTilesCard,
  PlanUsageCard,
  PlateauCard,
  TagDistributionCard,
} from "~/components/trainee-health";
import { requireUser } from "~/lib/api/auth";
import { loadUpcomingConsultations } from "~/lib/consultations";
import { type PlForms, daysAgo, fmtDate, fmtDateTime, pluralizePl } from "~/lib/format";
import { type ListControlsSpec, parseListControls } from "~/lib/list-params";
import { getFormStatusForTrainee } from "~/lib/onboarding-forms";
import { PlanError, deletePlan, listPlansForTrainee, planDeleteOutcomeMessage } from "~/lib/plans";
import { loadTraineeOverview } from "~/lib/stats";
import { TraineeDeleteError, deleteTraineeFully, findTraineeRef } from "~/lib/trainees";
import { type LogSort, type VideoFilter, listTraineeLogs } from "~/lib/workouts";

const SESJA: PlForms = { one: "sesja", few: "sesje", many: "sesji" };

const spec: ListControlsSpec = {
  sortOptions: [
    { key: "date_desc", label: "Najnowsze" },
    { key: "date_asc", label: "Najstarsze" },
    { key: "hardest", label: "Najtrudniejsze" },
    { key: "easiest", label: "Najłatwiejsze" },
    { key: "sets_desc", label: "Najwięcej serii" },
  ],
  defaultSort: "date_desc",
  filterGroups: [
    {
      param: "video",
      label: "Wideo",
      options: [
        { value: "all", label: "Wszystkie" },
        { value: "with", label: "Z wideo" },
        { value: "without", label: "Bez wideo" },
      ],
      defaultValue: "all",
    },
  ],
  searchable: true,
};

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const traineeId = args.params.traineeId ?? "";
  const url = new URL(args.request.url);
  const logsPage = parsePage(url.searchParams);
  const controls = parseListControls(url.searchParams, spec);

  // Nazwa do nagłówka i `404` dla cudzego podopiecznego. Kontrakt nie ma
  // `GET /v1/trainees/{id}` (luka L S5-2), więc moduł składa ją ze sklejonych
  // stron listy; data dołączenia zniknęła z nagłówka razem z wierszem bazy —
  // `TraineeListItem` jej nie niesie.
  const trainee = await findTraineeRef(api, traineeId);
  if (!trainee) throw new Response("not found", { status: 404 });

  // `null` = trener nie doczepił formularza startowego do zaproszenia — wtedy
  // plakietka w pasku przycisków w ogóle się nie renderuje.
  const onboardingStatus = await getFormStatusForTrainee(api, traineeId);

  // Plany pary zostają osobnym wywołaniem, choć przegląd niesie `activePlan`
  // i `draftPlan`: karta szkicu pokazuje `basedOnVersion` („bazuje na wersji X"),
  // a `PlanRef` z przeglądu tego pola nie ma.
  const plans = await listPlansForTrainee(api, traineeId);

  const activePlan = plans.find((p) => p.status === "active") ?? null;
  const draftPlan = plans.find((p) => p.status === "draft") ?? null;

  const video = (controls.filters.video ?? "all") as VideoFilter;

  const [overview, upcoming] = await Promise.all([
    // Osiem równoległych zapytań przez siedem funkcji `stats.ts` zastąpiło JEDNO
    // wywołanie: przegląd klienta jest po tamtej stronie jednym modelem odczytu.
    // Mapy aktywności nie ma w odpowiedzi i nie składamy jej z dziennika —
    // patrz LUKA L S5-1 niżej.
    loadTraineeOverview(api, traineeId),
    // Jedno wywołanie zamiast dwóch dawnych zapytań: najbliższy żywy termin
    // i liczba oczekujących wychodzą z tej samej listy. `pending` liczy tu
    // wyłącznie NADCHODZĄCE `planned` — przeszły `planned` jest dla trenera
    // „do udokumentowania", nie „do potwierdzenia".
    loadUpcomingConsultations(api, { nowISO: new Date().toISOString(), traineeId }),
  ]);
  const nextConsultation = upcoming.next;
  const pendingConsultations = upcoming.pending;

  const logPage = await listTraineeLogs(api, traineeId, {
    page: logsPage,
    sort: controls.sort as LogSort,
    q: controls.q,
    video,
  });

  return {
    trainee,
    onboardingStatus,
    activePlan,
    draftPlan,
    logs: logPage.items,
    logsPage: logPage.page,
    totalLogPages: logPage.totalPages,
    totalLogs: logPage.total,
    spec,
    controls,
    health: overview.health,
    plateau: overview.plateau,
    planUsage: overview.activePlan,
    videoCov: overview.videoCoverage,
    photoCov: overview.bodyPhotoCoverage,
    tagDist: overview.tags,
    nextConsultation,
    pendingConsultations,
  };
}

export async function action(args: ActionFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const traineeId = args.params.traineeId ?? "";

  // Pre-checku przynależności już tu nie ma: każda trasa `/v1/trainees/{id}/…`
  // oddaje `404` na cudzego, a usuwanie planu — na cudzy plan.
  const fd = await args.request.formData();
  const intent = fd.get("intent");

  if (intent === "delete-trainee") {
    try {
      // Nazwa do komunikatu po przekierowaniu. `DELETE` oddaje `204` bez treści,
      // a kontrakt nie ma trasy „jeden podopieczny" (luka L S5-2) — pytamy więc
      // PRZED usunięciem, bo po nim nie ma już czego pytać. To NIE jest bramka
      // tenanta: cudzy podopieczny odbija się dopiero o `404` z `DELETE`.
      const trainee = await findTraineeRef(api, traineeId);

      // Jedno żądanie zamiast kaskady w transakcji plus sprzątania bajtów:
      // BE kasuje przez granice kontekstów wraz z plikami I odwzorowaniami
      // kalendarza (ADR-0035), więc zamyka się przy okazji luka L S3-2 —
      // terminy usuniętej pary znikają z kalendarza trenera.
      await deleteTraineeFully(api, traineeId);
      throw redirect(
        `/trener/podopieczni?usuniety=${encodeURIComponent(trainee?.displayName ?? "")}`,
      );
    } catch (e) {
      if (e instanceof Response) throw e;
      if (e instanceof TraineeDeleteError) return { error: e.userMessage };
      throw e;
    }
  }

  if (intent !== "delete-plan") return null;
  const planId = String(fd.get("planId") ?? "");
  if (!planId) return { error: "Brak id planu." };
  try {
    const outcome = await deletePlan(api, planId);
    return { success: planDeleteOutcomeMessage(outcome) };
  } catch (e) {
    if (e instanceof PlanError) return { error: e.userMessage };
    throw e;
  }
}

export default function TrenerPodopiecznyDetail() {
  const {
    trainee,
    onboardingStatus,
    activePlan,
    draftPlan,
    logs,
    logsPage,
    totalLogPages,
    totalLogs,
    spec,
    controls,
    health,
    plateau,
    planUsage,
    videoCov,
    photoCov,
    tagDist,
    nextConsultation,
    pendingConsultations,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div>
      <div className="crumbs">
        <Link to="/trener/podopieczni">Podopieczni</Link>
        <span className="sep">›</span>
        <span className="current">{trainee.displayName}</span>
      </div>

      <div className="pagehead">
        <div>
          {/*
            Data dołączenia zniknęła z podtytułu: `TraineeListItem` jej nie niesie,
            a kontrakt nie ma innej trasy z faktami o jednym podopiecznym (L S5-2).
            Dołożenie `joinedOn` po stronie BE jest zmianą addytywną.
          */}
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Podopieczny
          </div>
          <h1>{trainee.displayName}</h1>
          {totalLogs > 0 && logs[0] && (
            <div className="sub">
              Ostatnia sesja{" "}
              <span style={{ color: "var(--ink-2)" }} className="mono">
                {daysAgo(logs[0].performedOn)}
              </span>{" "}
              · łącznie <span className="mono">{totalLogs}</span> {pluralizePl(totalLogs, SESJA)}
            </div>
          )}
          {nextConsultation && (
            <div className="sub" style={{ marginTop: 4 }}>
              <Icons.Consult style={{ marginRight: 6, color: "var(--muted)" }} />
              Najbliższa konsultacja{" "}
              <span style={{ color: "var(--ink-2)" }} className="mono">
                {fmtDateTime(nextConsultation.scheduledAt)}
              </span>
              {pendingConsultations > 0 && (
                <>
                  {" · "}
                  <span style={{ color: "var(--warn)" }} className="mono">
                    {pendingConsultations} do potwierdzenia
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link to={`/trener/podopieczni/${trainee.id}/rozwoj`} className="btn">
            <Icons.Trend /> Rozwój
          </Link>
          <Link to={`/trener/podopieczni/${trainee.id}/sylwetka`} className="btn">
            <Icons.Camera /> Sylwetka
          </Link>
          <Link to={`/trener/podopieczni/${trainee.id}/konsultacje`} className="btn">
            <Icons.Consult /> Konsultacje
            {pendingConsultations > 0 && (
              <span
                className="mono text-xs"
                style={{
                  marginLeft: 6,
                  color: "var(--warn)",
                  fontWeight: 600,
                  background: "var(--surface-2)",
                  padding: "1px 7px",
                  borderRadius: 999,
                }}
              >
                {pendingConsultations}
              </span>
            )}
          </Link>
          {onboardingStatus != null && (
            <Link to={`/trener/podopieczni/${trainee.id}/formularz`} className="btn">
              <Icons.Consult /> Formularz startowy
              {onboardingStatus.completedAtISO == null ? (
                <span className="badge" style={{ marginLeft: 6 }}>
                  <span className="badge-dot" />
                  czeka
                </span>
              ) : (
                <span className="text-xs muted" style={{ marginLeft: 6 }}>
                  wypełniony {fmtDate(onboardingStatus.completedAtISO)}
                </span>
              )}
            </Link>
          )}
          {draftPlan == null && (
            <Link to={`/trener/plany/nowy?traineeId=${trainee.id}`} className="btn btn-primary">
              <Icons.Plus /> Nowy plan
            </Link>
          )}
        </div>
      </div>

      <HealthTilesCard health={health} />

      {actionData != null && "success" in actionData && actionData.success != null && (
        <output
          style={{
            display: "block",
            color: "var(--ok)",
            fontSize: 13,
            marginBottom: 14,
            padding: "8px 12px",
            border: "1px solid var(--ok)",
            borderRadius: 8,
            background: "var(--accent-soft)",
          }}
        >
          {actionData.success}
        </output>
      )}
      {actionData != null && "error" in actionData && actionData.error != null && (
        <p
          role="alert"
          style={{
            color: "var(--danger)",
            fontSize: 13,
            marginBottom: 14,
            padding: "8px 12px",
            border: "1px solid var(--danger)",
            borderRadius: 8,
          }}
        >
          {actionData.error}
        </p>
      )}

      {activePlan && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row between" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div className="row" style={{ gap: 8, marginBottom: 8, alignItems: "center" }}>
                <span className="badge active">
                  <span className="badge-dot" />
                  aktywny plan
                </span>
                <span className="mono text-xs muted">
                  v{activePlan.version}
                  {activePlan.publishedAt && <> · od {fmtDate(activePlan.publishedAt)}</>}
                </span>
              </div>
              <h2 style={{ fontSize: 19, marginBottom: 4 }}>{activePlan.name}</h2>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Link to={`/trener/plany/${activePlan.id}`} className="btn btn-ghost">
                Pokaż
              </Link>
              <Link to={`/trener/plany/${activePlan.id}?edit=1`} className="btn">
                <Icons.Edit /> Edytuj plan
              </Link>
              <DeletePlanForm planId={activePlan.id} planName={activePlan.name} />
            </div>
          </div>
        </div>
      )}

      {draftPlan && draftPlan.id !== activePlan?.id && (
        <div
          className="card"
          style={{
            marginBottom: 14,
            borderStyle: "dashed",
            borderColor: "var(--line-2)",
            background: "var(--surface)",
          }}
        >
          <div className="row between" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div className="row" style={{ gap: 8, marginBottom: 8, alignItems: "center" }}>
                <span className="badge draft">
                  <span className="badge-dot" />
                  draft
                </span>
                <span className="mono text-xs muted">
                  Wersja {draftPlan.version} (Draft)
                  {draftPlan.basedOnVersion != null && (
                    <> — bazuje na wersji {draftPlan.basedOnVersion}</>
                  )}
                </span>
              </div>
              <h3 style={{ fontSize: 17 }}>{draftPlan.name}</h3>
              <div className="text-xs muted" style={{ marginTop: 4 }}>
                niedokończony
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Link to={`/trener/plany/${draftPlan.id}`} className="btn btn-dark">
                Wróć do edycji <Icons.Chev />
              </Link>
              <DeletePlanForm planId={draftPlan.id} planName={draftPlan.name} />
            </div>
          </div>
        </div>
      )}

      {activePlan == null && draftPlan == null && (
        <div
          className="card"
          style={{ marginBottom: 14, borderStyle: "dashed", borderColor: "var(--line-2)" }}
        >
          <div className="row between" style={{ alignItems: "center" }}>
            <div>
              <h3 style={{ fontSize: 16, marginBottom: 4 }}>Brak planu</h3>
              <div className="text-sm muted">
                Ten podopieczny nie ma jeszcze przypisanego planu treningowego.
              </div>
            </div>
            <Link to={`/trener/plany/nowy?traineeId=${trainee.id}`} className="btn btn-primary">
              <Icons.Plus /> Nowy plan
            </Link>
          </div>
        </div>
      )}

      {/*
        LUKA L S5-1 — mapa aktywności zniknęła z tego ekranu. `TraineeOverviewView`
        jej nie niesie, a `docs/03` („Klient — przegląd") mówi o niej wprost
        „jeszcze nie zbudowane". `TraineeHomeView.heatmap` to widok WŁASNY
        podopiecznego, nie trenera patrzącego na podopiecznego, więc go nie
        zastępuje. Świadomie nie składamy jej z dziennika treningowego: to byłoby
        N żądań po dane, które BE i tak liczy obok.
      */}
      <PlateauCard plateau={plateau} />
      <PlanUsageCard plan={planUsage} />
      <CoverageCard video={videoCov} photos={photoCov} traineeId={trainee.id} />
      <TagDistributionCard
        shares={tagDist.shares}
        untagged={tagDist.untagged}
        total={tagDist.totalExerciseLogs}
      />

      <h2 style={{ margin: "28px 0 12px", fontSize: 17 }}>Historia treningów</h2>
      <ListControls spec={spec} state={controls} searchPlaceholder="Szukaj po nazwie sesji…" />
      {totalLogs === 0 ? (
        <div className="empty">
          <h3>Brak sesji</h3>
          <div>Ten podopieczny jeszcze nic nie zarejestrował.</div>
        </div>
      ) : (
        <>
          <div className="list">
            {logs.map((log) => (
              <Link
                key={log.id}
                to={`/trener/podopieczni/${trainee.id}/log/${log.id}`}
                className="list-row"
                style={{ gridTemplateColumns: "76px 1fr auto auto", gap: 14 }}
              >
                <div className="mono text-xs muted">{fmtDate(log.performedOn)}</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{log.sessionName}</div>
                  <div className="text-xs muted" style={{ marginTop: 2 }}>
                    <span className="mono">{log.exerciseCount}</span> ćwiczeń ·{" "}
                    <span className="mono">{log.setCount}</span> serii · śr.{" "}
                    {log.avgDifficulty == null ? (
                      "—"
                    ) : (
                      <>
                        <span className="mono">{log.avgDifficulty}</span>/10
                      </>
                    )}
                    {log.hasVideo && " · video"}
                    {log.note && (
                      <span style={{ fontStyle: "italic", color: "var(--ink-2)" }}>
                        {" "}
                        · „{log.note.slice(0, 40)}
                        {log.note.length > 40 ? "…" : ""}"
                      </span>
                    )}
                  </div>
                </div>
                <DifficultyBadge avg={log.avgDifficulty} />
                <Icons.Chev style={{ color: "var(--muted-2)" }} />
              </Link>
            ))}
          </div>
          <Pagination
            page={logsPage}
            totalPages={totalLogPages}
            total={totalLogs}
            totalLabel={pluralizePl(totalLogs, SESJA)}
          />
        </>
      )}

      <div
        style={{
          marginTop: 40,
          paddingTop: 20,
          borderTop: "1px solid var(--line)",
        }}
      >
        <h2 className="muted" style={{ fontSize: 14, marginBottom: 10 }}>
          Strefa niebezpieczna
        </h2>
        <div
          className="card"
          style={{
            padding: 14,
            borderColor: "var(--danger)",
            borderStyle: "dashed",
          }}
        >
          <div className="row between" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
                Usuń podopiecznego
              </div>
              <div className="text-xs muted">
                Konto, wszystkie plany, historia treningów, zdjęcia sylwetki i nagrania video
                zostaną <strong>nieodwracalnie skasowane</strong>, a nadchodzące spotkania usunięte
                z Twojego Kalendarza Google.
              </div>
            </div>
            <Form method="post" style={{ flexShrink: 0 }}>
              <input type="hidden" name="intent" value="delete-trainee" />
              <ConfirmSubmitButton
                className="btn btn-danger"
                confirmOptions={{
                  title: `Usunąć podopiecznego „${trainee.displayName}"?`,
                  message:
                    "Wszystkie dane tej osoby (plany, sesje, video, zdjęcia) zostaną nieodwracalnie skasowane, a nadchodzące spotkania usunięte z Kalendarza Google. Tej operacji nie da się cofnąć.",
                  destructive: true,
                  confirmText: "Usuń podopiecznego",
                }}
              >
                <Icons.Trash /> Usuń podopiecznego
              </ConfirmSubmitButton>
            </Form>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeletePlanForm({ planId, planName }: { planId: string; planName: string }) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="delete-plan" />
      <input type="hidden" name="planId" value={planId} />
      <ConfirmSubmitButton
        className="btn btn-icon btn-ghost"
        style={{ color: "var(--danger)" }}
        title="Usuń plan"
        aria-label={`Usuń plan ${planName}`}
        confirmOptions={{
          title: `Usunąć plan „${planName}"?`,
          message:
            "Jeśli plan ma już zalogowane sesje, zostanie zarchiwizowany (historia zachowana). Inaczej — skasowany na stałe.",
          destructive: true,
          confirmText: "Usuń plan",
        }}
      >
        <Icons.X />
      </ConfirmSubmitButton>
    </Form>
  );
}

function DifficultyBadge({ avg }: { avg: number | null }) {
  if (avg == null) {
    return (
      <span className="badge" style={{ color: "var(--muted)" }}>
        —
      </span>
    );
  }
  if (avg === 0) return <span />;
  const tone = avg <= 4 ? "var(--ok)" : avg <= 7 ? "var(--warn)" : "var(--danger)";
  return (
    <span
      className="mono"
      style={{
        fontSize: 12,
        color: tone,
        fontWeight: 600,
        background: "var(--surface-2)",
        padding: "2px 8px",
        borderRadius: 999,
      }}
    >
      {avg}
    </span>
  );
}
