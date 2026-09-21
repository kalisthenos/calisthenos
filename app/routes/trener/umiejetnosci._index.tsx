import { Link, type LoaderFunctionArgs, useLoaderData } from "react-router";
import { Icons } from "~/components/icons";
import { ListControls } from "~/components/list-controls";
import { requireUser } from "~/lib/api/auth";
import { type ListControlsSpec, parseListControls } from "~/lib/list-params";
import { SKILL_TIERS, type SkillTier, TIER_LABEL } from "~/lib/skill-tier";
import { type SkillListItem, listSkillsForTrainer } from "~/lib/skills";

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const url = new URL(args.request.url);
  // Kontrakt oddaje grupy po stopniu, bez sortowania i filtra — obie kontrolki
  // zostają tu, bo lista przychodzi w całości (bez stronicowania).
  const groups = await listSkillsForTrainer(api);
  const total = groups.reduce((n, g) => n + g.skills.length, 0);

  const spec: ListControlsSpec = {
    sortOptions: [
      { key: "name", label: "Nazwa" },
      { key: "variations", label: "Liczba wariantów" },
    ],
    defaultSort: "name",
    filterGroups: [
      {
        param: "tier",
        label: "Poziom trudności",
        options: [
          { value: "all", label: "Wszystkie" },
          ...SKILL_TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] })),
        ],
        defaultValue: "all",
      },
    ],
    searchable: false,
  };
  const controls = parseListControls(url.searchParams, spec);
  const tier = controls.filters.tier ?? "all";

  const byName = (a: SkillListItem, b: SkillListItem) => a.name.localeCompare(b.name, "pl");
  const sortSkills = (skills: SkillListItem[]) =>
    [...skills].sort((a, b) =>
      controls.sort === "variations"
        ? b.variationCount - a.variationCount || byName(a, b)
        : byName(a, b),
    );

  // Sekcje od podstaw w górę — lista czyta się jak program, nie jak piramida.
  // Kolejność bierze się z `SKILL_TIERS`, nie z kolejności grup w odpowiedzi.
  const sections = SKILL_TIERS.filter((t) => tier === "all" || t === tier)
    .map((t) => ({
      tier: t,
      skills: sortSkills(groups.filter((g) => g.tier === t).flatMap((g) => g.skills)),
    }))
    .filter((s) => s.skills.length > 0);
  const shown = sections.reduce((n, s) => n + s.skills.length, 0);

  return { sections, total, shown, spec, controls };
}

export default function UmiejetnosciList() {
  const { sections, total, shown, spec, controls } = useLoaderData<typeof loader>();
  return (
    <div>
      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Trener
          </div>
          <h1>Umiejętności</h1>
          <div className="sub">
            {total === 0
              ? "Brak umiejętności."
              : shown === total
                ? `${total} umiejętności.`
                : `${shown} z ${total} umiejętności.`}
          </div>
        </div>
        <Link to="/trener/umiejetnosci/nowa" className="btn btn-primary">
          <Icons.Plus /> Nowa umiejętność
        </Link>
      </div>

      {total > 0 && <ListControls spec={spec} state={controls} />}

      {total === 0 ? (
        <div className="empty">
          <h3>Brak umiejętności</h3>
          <div>Utwórz pierwszą drabinę wariantów (np. Front Lever), by śledzić progresję.</div>
        </div>
      ) : sections.length === 0 ? (
        <div className="empty">
          <h3>Brak umiejętności na tym poziomie</h3>
          <div>Zmień filtr, by zobaczyć pozostałe.</div>
        </div>
      ) : (
        <div className="col" style={{ gap: 26 }}>
          {sections.map((section) => (
            <TierSection key={section.tier} tier={section.tier} skills={section.skills} />
          ))}
        </div>
      )}
    </div>
  );
}

function TierSection({
  tier,
  skills,
}: {
  tier: SkillTier;
  skills: SkillListItem[];
}) {
  return (
    <section>
      <div
        className="row between"
        style={{ marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid var(--line)" }}
      >
        <h2 className="uppercase-label" style={{ margin: 0 }}>
          {TIER_LABEL[tier]}
        </h2>
        <span className="mono text-xs muted">{skills.length}</span>
      </div>
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}
      >
        {skills.map((s) => (
          <Link
            key={s.id}
            to={`/trener/umiejetnosci/${s.id}`}
            className="card card-hover"
            style={{ padding: 14 }}
          >
            <h3 style={{ margin: 0 }}>{s.name}</h3>
            <div className="text-xs muted" style={{ marginTop: 8 }}>
              {s.variationCount} wariantów
            </div>
            {s.description && (
              <div className="text-sm muted" style={{ marginTop: 8, lineHeight: 1.4 }}>
                {s.description}
              </div>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
