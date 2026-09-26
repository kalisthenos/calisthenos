import {
  type ActionFunctionArgs,
  Form,
  Link,
  type LoaderFunctionArgs,
  useActionData,
  useLoaderData,
} from "react-router";
import { ExerciseProgressionPanel } from "~/components/exercise-progression-panel";
import { VariationLadder } from "~/components/skill-tree";
import { TierBadge } from "~/components/tier-badge";
import { requireUser } from "~/lib/api/auth";
import { ApiError, toRouteResponse } from "~/lib/api/errors";
import { fmtDate } from "~/lib/format";
import { loadTraineeExerciseProgression, todayIso } from "~/lib/progression";
import type { ProgressionRange } from "~/lib/progression-math";
import {
  currentVariationOf,
  loadTraineeSkillMap,
  recordAdvancement,
  setStartingLevel,
} from "~/lib/skill-progression";
import { AdvancementFormSchema } from "~/lib/skill-types";
import { SkillError } from "~/lib/skills";
import { findTraineeRef } from "~/lib/trainees";

const RANGES: ProgressionRange[] = ["4w", "3m", "6m", "all"];

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const traineeId = args.params.traineeId ?? "";
  const skillId = args.params.skillId ?? "";
  // Nazwa do nagłówka i `404` dla cudzego podopiecznego — ze sklejonych stron
  // listy, bo kontrakt nie ma trasy „jeden podopieczny" (luka L S5-2).
  const trainee = await findTraineeRef(api, traineeId);
  if (!trainee) throw new Response("not found", { status: 404 });
  // Mapa niesie drabinę, bieżący poziom i historię każdej umiejętności; sugestii
  // awansu w niej NIE ma (luka L S1-1) — kontrakt nie oddaje sygnałów, na których
  // stała, więc ekran przestał ją pokazywać, zamiast składać ją z N wywołań.
  const map = await loadTraineeSkillMap(api, traineeId);
  const entry = map.find((m) => m.skillId === skillId);
  if (!entry) throw new Response("not found", { status: 404 });

  const url = new URL(args.request.url);
  const raw = url.searchParams.get("zakres");
  const range: ProgressionRange = (RANGES as string[]).includes(raw ?? "")
    ? (raw as ProgressionRange)
    : "3m";
  // Brak logów na bieżącym wariancie to po stronie BE `404`, tu `null` — dawna
  // flaga `currentHasLogs` z mapy przestała być potrzebna.
  const current = currentVariationOf(entry);
  const view = current
    ? await loadTraineeExerciseProgression(api, traineeId, current.exerciseId, range)
    : null;

  return { trainee, entry, view, range, today: todayIso() };
}

export async function action(args: ActionFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const traineeId = args.params.traineeId ?? "";
  const skillId = args.params.skillId ?? "";
  // Pre-checku przynależności tu już nie ma: obie mutacje idą pod
  // `/v1/trainees/{traineeId}/skills/{skillId}/…`, więc cudzy podopieczny
  // odbija się o `404` z samego zapisu — a nazwa w akcji nie jest potrzebna.

  const fd = await args.request.formData();
  const intent = fd.get("intent");
  if (intent !== "advance" && intent !== "set-start") return null;

  const parsed = AdvancementFormSchema.safeParse({
    toVariationId: String(fd.get("toVariationId") ?? ""),
    advancedOn: String(fd.get("advancedOn") ?? ""),
    note: fd.get("note") ? String(fd.get("note")) : undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Niepoprawne dane." };
  const { toVariationId, advancedOn, note } = parsed.data;
  try {
    if (intent === "set-start") {
      await setStartingLevel(api, traineeId, skillId, toVariationId, advancedOn, note ?? null);
    } else {
      await recordAdvancement(api, traineeId, skillId, toVariationId, advancedOn, note ?? null);
    }
    return { ok: true };
  } catch (e) {
    // „Bez poziomu startowego", „ten sam poziom", drugi poziom startowy — `409`
    // z treścią do formularza; każda inna odmowa BE idzie na granicę błędu.
    if (e instanceof SkillError) return { error: e.userMessage };
    if (e instanceof ApiError) throw toRouteResponse(e);
    throw e;
  }
}

export default function TrenerRozwojWezel() {
  const { trainee, entry, view, range, today } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const intent = entry.currentVariationId ? "advance" : "set-start";
  const submitLabel = entry.currentVariationId ? "Zapisz zmianę" : "Ustaw poziom";
  const selectLabel = entry.currentVariationId ? "Zmień na" : "Poziom startowy";

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="crumbs">
        <Link to="/trener/podopieczni">Podopieczni</Link>
        <span className="sep">›</span>
        <Link to={`/trener/podopieczni/${trainee.id}`}>{trainee.displayName}</Link>
        <span className="sep">›</span>
        <Link to={`/trener/podopieczni/${trainee.id}/rozwoj`}>Rozwój</Link>
        <span className="sep">›</span>
        <span className="current">{entry.skillName}</span>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div className="text-xs muted" style={{ marginBottom: 4 }}>
          {trainee.displayName}
        </div>
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <h1 style={{ margin: "0 0 4px" }}>{entry.skillName}</h1>
          <TierBadge tier={entry.tier} />
        </div>
        <div className="text-sm muted">Drabina wariantów, awanse i wyniki bieżącego wariantu.</div>
      </div>

      {actionData != null && "error" in actionData && actionData.error != null && (
        <p role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>
          {actionData.error}
        </p>
      )}

      <div style={{ marginBottom: 12 }}>
        <VariationLadder
          variations={entry.variations}
          currentVariationId={entry.currentVariationId}
        />
      </div>

      {entry.lastAdvancedOn && (
        <div className="text-xs muted" style={{ marginBottom: 16 }}>
          Ostatni awans: {fmtDate(entry.lastAdvancedOn)}
        </div>
      )}

      {entry.variations.length > 0 && (
        <Form
          method="post"
          className="card"
          style={{ padding: 16, display: "grid", gap: 12, marginBottom: 22 }}
        >
          <input type="hidden" name="intent" value={intent} />

          <label className="col" style={{ gap: 4 }}>
            <span className="text-sm">{selectLabel}</span>
            <select name="toVariationId" className="input" required defaultValue="">
              <option value="" disabled>
                Wybierz wariant…
              </option>
              {entry.variations.map((v) => (
                <option key={v.id} value={v.id} disabled={v.id === entry.currentVariationId}>
                  {v.ordinal}. {v.exerciseName}
                </option>
              ))}
            </select>
          </label>

          <label className="col" style={{ gap: 4 }}>
            <span className="text-sm">Data</span>
            <input type="date" name="advancedOn" className="input" defaultValue={today} required />
          </label>

          <label className="col" style={{ gap: 4 }}>
            <span className="text-sm">Notatka</span>
            <input
              type="text"
              name="note"
              className="input"
              maxLength={2000}
              placeholder="np. czysto 3×5×20 s"
            />
          </label>

          <button type="submit" className="btn btn-primary">
            {submitLabel}
          </button>
        </Form>
      )}

      {view ? (
        <ExerciseProgressionPanel view={view} range={range} />
      ) : (
        <div className="card" style={{ padding: 18, marginBottom: 18 }}>
          <div className="muted text-sm">
            {entry.currentVariationId
              ? "Brak danych — podopieczny nie zalogował jeszcze treningu na bieżącym wariancie."
              : "Ustaw poziom startowy, aby śledzić wyniki w czasie."}
          </div>
        </div>
      )}

      {entry.history.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="text-sm" style={{ cursor: "pointer", marginBottom: 8 }}>
            Historia awansów ({entry.history.length})
          </summary>
          <ul className="text-xs muted" style={{ margin: 0, paddingLeft: 16 }}>
            {entry.history.map((h, i) => (
              <li key={`${h.advancedOn}-${i}`}>
                {fmtDate(h.advancedOn)} — {h.fromVariationId ? "awans" : "poziom startowy"}
                {h.note ? ` · „${h.note}"` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
