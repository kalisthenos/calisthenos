import { type LoaderFunctionArgs, useLoaderData } from "react-router";
import { ProgressionList } from "~/components/progression-list";
import { SkillTreeView } from "~/components/skill-tree";
import { requireUser } from "~/lib/api/auth";
import { type ListControlsSpec, parseListControls } from "~/lib/list-params";
import { developmentSortFrom, loadMyDevelopment } from "~/lib/skill-tree";

// Podopieczny domyślnie ogląda „ostatnio trenowane" — to także domyślna
// kontraktu, ale sortowanie idzie jawnie, żeby adres i odpowiedź mówiły to samo.
const DEFAULT_SORT = "recent";

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainee" });
  const url = new URL(args.request.url);

  // Jedno wywołanie na ekran: drzewo ze stanami, lista „pozostałych ćwiczeń"
  // (już bez wariantów umiejętności — wyklucza je BE), podsumowanie i opcje
  // tagów. Sort i tag idą do BE PRZED zbudowaniem kontrolek, bo opcje tagów
  // przychodzą dopiero z odpowiedzią; nieznaną wartość BE ignoruje (`docs/04` §5).
  const sort = developmentSortFrom(url.searchParams.get("sort"), DEFAULT_SORT);
  const tag = url.searchParams.get("tag") ?? "all";
  const development = await loadMyDevelopment(api, { sort, tag });

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
    tree: development.tree,
    rows: development.exercises.items,
    summary: development.exercises.summary,
    spec,
    controls,
  };
}

export default function PodopiecznyRozwoj() {
  const { tree, rows, summary, spec, controls } = useLoaderData<typeof loader>();
  return (
    <div>
      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Podopieczny
          </div>
          <h1>Rozwój</h1>
          <div className="sub">Twoje drzewo umiejętności i postęp w ćwiczeniach.</div>
        </div>
      </div>

      <SkillTreeView
        tree={tree}
        hrefForNode={(skillId) => `/podopieczny/rozwoj/umiejetnosc/${skillId}`}
      />

      <div style={{ marginTop: 28 }}>
        <ProgressionList
          title="Pozostałe ćwiczenia"
          rows={rows}
          summary={summary}
          spec={spec}
          controls={controls}
          hrefForExercise={(id) => `/podopieczny/rozwoj/cwiczenie/${id}`}
          buildCompareHref={(ids) => `/podopieczny/rozwoj/porownanie?ex=${ids.join(",")}`}
        />
      </div>
    </div>
  );
}
