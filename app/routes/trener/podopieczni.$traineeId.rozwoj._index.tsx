import { Link, type LoaderFunctionArgs, useLoaderData } from "react-router";
import { ProgressionList } from "~/components/progression-list";
import { SkillTreeView } from "~/components/skill-tree";
import { requireUser } from "~/lib/api/auth";
import { type ListControlsSpec, parseListControls } from "~/lib/list-params";
import { developmentSortFrom, loadTraineeDevelopment } from "~/lib/skill-tree";
import { findTraineeRef } from "~/lib/trainees";

// Trener domyślnie ogląda „wymaga uwagi" — kontrakt domyślnie sortuje po
// „ostatnio trenowane", więc sortowanie idzie do BE zawsze jawnie.
const DEFAULT_SORT = "attention";

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const traineeId = args.params.traineeId ?? "";
  // Nazwa do nagłówka i `404` dla cudzego podopiecznego. Widok rozwoju nazwy nie
  // niesie, a kontrakt nie ma trasy „jeden podopieczny" — moduł składa ją ze
  // sklejonych stron listy (luka L S5-2).
  const trainee = await findTraineeRef(api, traineeId);
  if (!trainee) throw new Response("not found", { status: 404 });
  const url = new URL(args.request.url);

  // Sort i tag idą do BE PRZED zbudowaniem kontrolek, bo opcje tagów przychodzą
  // dopiero z odpowiedzią. Nieznaną wartość obu BE ignoruje (`docs/04` §5), więc
  // `parseListControls` niżej pokaże dokładnie ten stan, który BE zastosował.
  const sort = developmentSortFrom(url.searchParams.get("sort"), DEFAULT_SORT);
  const tag = url.searchParams.get("tag") ?? "all";
  const development = await loadTraineeDevelopment(api, traineeId, { sort, tag });

  const spec: ListControlsSpec = {
    sortOptions: [
      { key: "recent", label: "Ostatnio trenowane" },
      { key: "attention", label: "Wymaga uwagi" },
    ],
    defaultSort: DEFAULT_SORT,
    filterGroups: [
      {
        param: "tag",
        label: "Kategoria",
        options: [
          { value: "all", label: "Wszystkie" },
          ...development.exercises.tagOptions.map((t) => ({ value: t, label: t })),
        ],
        defaultValue: "all",
      },
    ],
    searchable: false,
  };
  const controls = parseListControls(url.searchParams, spec);

  return {
    trainee,
    tree: development.tree,
    rows: development.exercises.items,
    summary: development.exercises.summary,
    spec,
    controls,
  };
}

export default function TrenerRozwoj() {
  const { trainee, tree, rows, summary, spec, controls } = useLoaderData<typeof loader>();
  return (
    <div>
      <div className="crumbs">
        <Link to="/trener/podopieczni">Podopieczni</Link>
        <span className="sep">›</span>
        <Link to={`/trener/podopieczni/${trainee.id}`}>{trainee.displayName}</Link>
        <span className="sep">›</span>
        <span className="current">Rozwój</span>
      </div>

      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            {trainee.displayName}
          </div>
          <h1>Rozwój</h1>
          <div className="sub">
            Drzewo umiejętności i postęp w ćwiczeniach. Klik węzeł, by zarządzać poziomem.
          </div>
        </div>
      </div>

      <SkillTreeView
        tree={tree}
        hrefForNode={(skillId) => `/trener/podopieczni/${trainee.id}/rozwoj/umiejetnosc/${skillId}`}
      />

      <div style={{ marginTop: 28 }}>
        <ProgressionList
          title="Pozostałe ćwiczenia"
          rows={rows}
          summary={summary}
          spec={spec}
          controls={controls}
          hrefForExercise={(id) => `/trener/podopieczni/${trainee.id}/rozwoj/cwiczenie/${id}`}
          buildCompareHref={(ids) =>
            `/trener/podopieczni/${trainee.id}/rozwoj/porownanie?ex=${ids.join(",")}`
          }
        />
      </div>
    </div>
  );
}
