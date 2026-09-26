import { Link, type LoaderFunctionArgs, useLoaderData } from "react-router";
import { ExerciseProgressionPanel } from "~/components/exercise-progression-panel";
import { VariationLadder } from "~/components/skill-tree";
import { TierBadge } from "~/components/tier-badge";
import { requireUser } from "~/lib/api/auth";
import { fmtDate } from "~/lib/format";
import { loadMyExerciseProgression } from "~/lib/progression";
import type { ProgressionRange } from "~/lib/progression-math";
import { currentVariationOf, loadMySkillMap } from "~/lib/skill-progression";

const RANGES: ProgressionRange[] = ["4w", "3m", "6m", "all"];

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainee" });
  const skillId = args.params.skillId ?? "";
  // Własna mapa (`/v1/me/skill-progress`) — trenera wyprowadza BE z tokenu, więc
  // dawne sprawdzenie `user.trainerId` w tej trasie zniknęło.
  const map = await loadMySkillMap(api);
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
  const view = current ? await loadMyExerciseProgression(api, current.exerciseId, range) : null;

  return { entry, view, range };
}

export default function PodopiecznyRozwojWezel() {
  const { entry, view, range } = useLoaderData<typeof loader>();
  return (
    <div>
      <div className="crumbs">
        <Link to="/podopieczny/rozwoj">Rozwój</Link>
        <span className="sep">›</span>
        <span className="current">{entry.skillName}</span>
      </div>

      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Podopieczny
          </div>
          <div className="row" style={{ gap: 10, alignItems: "center" }}>
            <h1>{entry.skillName}</h1>
            <TierBadge tier={entry.tier} />
          </div>
          <div className="sub">Twoja pozycja na drabinie i wyniki bieżącego wariantu.</div>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 22 }}>
        <VariationLadder
          variations={entry.variations}
          currentVariationId={entry.currentVariationId}
        />
        {entry.lastAdvancedOn && (
          <div className="text-xs muted" style={{ marginTop: 10 }}>
            Ostatni awans: {fmtDate(entry.lastAdvancedOn)}
          </div>
        )}
      </div>

      {view ? (
        <ExerciseProgressionPanel view={view} range={range} />
      ) : (
        <div className="card" style={{ padding: 18 }}>
          <div className="muted text-sm">
            {entry.currentVariationId
              ? "Brak danych — zaloguj trening na tym wariancie, aby zobaczyć wyniki w czasie."
              : "Trener nie ustawił jeszcze Twojego poziomu na tej umiejętności."}
          </div>
        </div>
      )}
    </div>
  );
}
