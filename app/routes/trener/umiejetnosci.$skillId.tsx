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
import { TierBadge } from "~/components/tier-badge";
import { requireUser } from "~/lib/api/auth";
import { ApiError, toRouteResponse } from "~/lib/api/errors";
import { pluralizePl } from "~/lib/format";
import { SKILL_TIERS, TIER_LABEL } from "~/lib/skill-tier";
import { PrerequisiteFormSchema, ReorderFormSchema, SkillFormSchema } from "~/lib/skill-types";
import {
  SkillError,
  addPrerequisite,
  addVariation,
  archiveSkill,
  getSkillWithVariations,
  removePrerequisite,
  removeVariation,
  reorderVariations,
  updateSkill,
} from "~/lib/skills";

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const skillId = args.params.skillId ?? "";
  // Jedno wywołanie: szczegół niesie warianty, prerekwizyty, kandydatów na
  // prerekwizyt, konflikty stopni i ćwiczenia wolne do przypięcia — dawne
  // cztery osobne listy edytora są polami tej odpowiedzi.
  const skill = await getSkillWithVariations(api, skillId);
  if (!skill) throw new Response("not found", { status: 404 });
  return { skill };
}

export async function action(args: ActionFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const skillId = args.params.skillId ?? "";
  const fd = await args.request.formData();
  const intent = fd.get("intent");
  try {
    if (intent === "save") {
      const parsed = SkillFormSchema.safeParse({
        name: String(fd.get("name") ?? ""),
        description: String(fd.get("description") ?? ""),
        tier: fd.has("tier") ? String(fd.get("tier")) : undefined,
      });
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Niepoprawne dane." };
      await updateSkill(api, skillId, parsed.data.name, parsed.data.description, parsed.data.tier);
      return { success: "Zapisano zmiany." };
    }
    if (intent === "add-variation") {
      const exerciseId = String(fd.get("exerciseId") ?? "");
      if (exerciseId) await addVariation(api, skillId, exerciseId);
      return { ok: true };
    }
    if (intent === "remove-variation") {
      const variationId = String(fd.get("variationId") ?? "");
      if (variationId) await removeVariation(api, skillId, variationId);
      return { ok: true };
    }
    if (intent === "move") {
      const parsed = ReorderFormSchema.safeParse({
        variationIds: fd.getAll("variationIds").map(String),
      });
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Niepoprawne dane." };
      await reorderVariations(api, skillId, parsed.data.variationIds);
      return { ok: true };
    }
    if (intent === "archive") {
      await archiveSkill(api, skillId);
      throw redirect("/trener/umiejetnosci");
    }
    if (intent === "add-prereq") {
      const parsed = PrerequisiteFormSchema.safeParse({
        skillId,
        requiresSkillId: String(fd.get("requiresSkillId") ?? ""),
      });
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Niepoprawne dane." };
      // Cykl, wyższy stopień prereka i duplikat odrzuca BE (`409`) — tu nie ma
      // już pre-checków, więc picker i akcja nie mogą się rozjechać.
      await addPrerequisite(api, skillId, parsed.data.requiresSkillId);
      return { ok: true };
    }
    if (intent === "remove-prereq") {
      const requiresSkillId = String(fd.get("requiresSkillId") ?? "");
      if (requiresSkillId) await removePrerequisite(api, skillId, requiresSkillId);
      return { ok: true };
    }
    return null;
  } catch (e) {
    if (e instanceof Response) throw e;
    // Odmowy z treścią dla formularza (`400`/`404`/`409`) przychodzą jako
    // `SkillError`; każda inna odpowiedź BE idzie na granicę błędu z jej kodem.
    if (e instanceof SkillError) return { error: e.userMessage };
    if (e instanceof ApiError) throw toRouteResponse(e);
    throw e;
  }
}

export default function EdytorUmiejetnosci() {
  const { skill } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const ids = skill.variations.map((v) => v.id);

  function reorderedIds(from: number, to: number): string[] {
    const copy = [...ids];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved!);
    return copy;
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="crumbs">
        <Link to="/trener/umiejetnosci">Umiejętności</Link>
        <span className="sep">›</span>
        <span className="current">{skill.name}</span>
        <TierBadge tier={skill.tier} />
      </div>

      {actionData != null && "error" in actionData && actionData.error != null && (
        <p role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>
          {actionData.error}
        </p>
      )}

      {actionData != null && "success" in actionData && actionData.success != null && (
        <output style={{ display: "block", color: "var(--ok)", fontSize: 13, marginBottom: 12 }}>
          {actionData.success}
        </output>
      )}

      <Form
        method="post"
        className="card"
        style={{ padding: 16, display: "grid", gap: 12, marginBottom: 18 }}
      >
        <input type="hidden" name="intent" value="save" />
        <label className="col" style={{ gap: 4 }}>
          <span className="text-sm">Nazwa</span>
          <input name="name" className="input" defaultValue={skill.name} maxLength={120} required />
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="text-sm">Opis</span>
          <textarea
            name="description"
            className="input"
            defaultValue={skill.description}
            maxLength={2000}
            rows={3}
          />
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="text-sm">Poziom trudności</span>
          <select name="tier" className="input" defaultValue={skill.tier}>
            {SKILL_TIERS.map((t) => (
              <option key={t} value={t}>
                {TIER_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn">
          Zapisz
        </button>
      </Form>

      <h2 style={{ fontSize: 17, margin: "0 0 10px" }}>Warianty (od najłatwiejszego)</h2>
      {skill.variations.length === 0 ? (
        <div className="text-sm muted" style={{ marginBottom: 12 }}>
          Brak wariantów. Dodaj co najmniej jeden, by móc przypisać poziom startowy podopiecznemu.
        </div>
      ) : (
        <div className="col" style={{ gap: 8, marginBottom: 16 }}>
          {skill.variations.map((v, i) => (
            <div key={v.id} className="card row between" style={{ padding: "10px 14px", gap: 10 }}>
              <div className="row" style={{ gap: 10, alignItems: "center" }}>
                <span className="mono text-xs muted">{v.ordinal}</span>
                <span style={{ fontWeight: 500 }}>{v.exerciseName}</span>
                <span className="badge">{v.unit}</span>
              </div>
              <div className="row" style={{ gap: 4 }}>
                {i > 0 && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="move" />
                    {reorderedIds(i, i - 1).map((id) => (
                      <input key={id} type="hidden" name="variationIds" value={id} />
                    ))}
                    <button type="submit" className="btn btn-sm btn-ghost" aria-label="W górę">
                      ↑
                    </button>
                  </Form>
                )}
                {i < skill.variations.length - 1 && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="move" />
                    {reorderedIds(i, i + 1).map((id) => (
                      <input key={id} type="hidden" name="variationIds" value={id} />
                    ))}
                    <button type="submit" className="btn btn-sm btn-ghost" aria-label="W dół">
                      ↓
                    </button>
                  </Form>
                )}
                <Form method="post">
                  <input type="hidden" name="intent" value="remove-variation" />
                  <input type="hidden" name="variationId" value={v.id} />
                  <ConfirmSubmitButton
                    className="btn btn-sm btn-ghost"
                    style={{ color: "var(--danger)" }}
                    title="Usuń wariant"
                    confirmOptions={{
                      title: `Usunąć wariant „${v.exerciseName}"?`,
                      message:
                        "Jeśli jest użyty w historii awansów, usunięcie zostanie zablokowane.",
                      destructive: true,
                      confirmText: "Usuń",
                    }}
                  >
                    <Icons.X />
                  </ConfirmSubmitButton>
                </Form>
              </div>
            </div>
          ))}
        </div>
      )}

      <Form method="post" className="row" style={{ gap: 8 }}>
        <input type="hidden" name="intent" value="add-variation" />
        <select name="exerciseId" className="input" style={{ flex: 1 }} required defaultValue="">
          <option value="" disabled>
            Dodaj ćwiczenie jako wariant…
          </option>
          {skill.assignableExercises.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.name} ({ex.unit})
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary">
          <Icons.Plus /> Dodaj
        </button>
      </Form>

      <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
        <h2 style={{ fontSize: 17, margin: "0 0 10px" }}>Wymaga (prerekwizyty)</h2>
        <p className="text-sm muted" style={{ marginBottom: 12 }}>
          Umiejętności, które trzeba opanować, zanim odblokuje się ta.
        </p>
        {skill.tierConflicts.length > 0 && (
          <div className="alert alert-error" role="alert">
            {`${skill.tierConflicts.length} ${pluralizePl(skill.tierConflicts.length, {
              one: "prerekwizyt jest trudniejszy",
              few: "prerekwizyty są trudniejsze",
              many: "prerekwizytów jest trudniejszych",
            })} od tej umiejętności:`}{" "}
            {skill.tierConflicts
              .map((c) => `${c.requiresSkillName} (${TIER_LABEL[c.requiresTier].toUpperCase()})`)
              .join(", ")}
            . Podnieś tier tej umiejętności albo usuń te połączenia — w drzewie rysują się odwrotnie
            do kierunku piramidy.
          </div>
        )}
        {skill.prerequisites.length === 0 ? (
          <div className="text-sm muted" style={{ marginBottom: 12 }}>
            Brak prerekwizytów — to korzeń drzewa.
          </div>
        ) : (
          <div className="col" style={{ gap: 8, marginBottom: 16 }}>
            {skill.prerequisites.map((p) => (
              <div
                key={p.id}
                className="card row between"
                style={{ padding: "10px 14px", gap: 10 }}
              >
                <span className="row" style={{ gap: 8 }}>
                  <span style={{ fontWeight: 500 }}>{p.name}</span>
                  <TierBadge tier={p.tier} />
                </span>
                <Form method="post">
                  <input type="hidden" name="intent" value="remove-prereq" />
                  <input type="hidden" name="requiresSkillId" value={p.id} />
                  <button
                    type="submit"
                    className="btn btn-sm btn-ghost"
                    style={{ color: "var(--danger)" }}
                    aria-label={`Usuń prerekwizyt ${p.name}`}
                  >
                    <Icons.X />
                  </button>
                </Form>
              </div>
            ))}
          </div>
        )}
        {skill.assignablePrerequisites.length === 0 ? (
          <div className="text-sm muted" style={{ marginBottom: 16 }}>
            Brak innych umiejętności do dodania.
          </div>
        ) : (
          <Form method="post" className="row" style={{ gap: 8 }}>
            <input type="hidden" name="intent" value="add-prereq" />
            <select
              name="requiresSkillId"
              className="input"
              style={{ flex: 1 }}
              required
              defaultValue=""
            >
              <option value="" disabled>
                Dodaj wymaganą umiejętność…
              </option>
              {skill.assignablePrerequisites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-primary">
              <Icons.Plus /> Dodaj
            </button>
          </Form>
        )}
      </div>

      <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
        <Form method="post">
          <input type="hidden" name="intent" value="archive" />
          <ConfirmSubmitButton
            className="btn btn-danger"
            confirmOptions={{
              title: `Zarchiwizować „${skill.name}"?`,
              message: "Umiejętność zniknie z listy. Historia awansów podopiecznych pozostanie.",
              destructive: true,
              confirmText: "Zarchiwizuj",
            }}
          >
            <Icons.Trash /> Zarchiwizuj umiejętność
          </ConfirmSubmitButton>
        </Form>
      </div>
    </div>
  );
}
