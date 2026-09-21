import {
  type ActionFunctionArgs,
  Form,
  type LoaderFunctionArgs,
  redirect,
  useActionData,
} from "react-router";
import { requireUser } from "~/lib/api/auth";
import { ApiError, toRouteResponse } from "~/lib/api/errors";
import { SKILL_TIERS, TIER_LABEL } from "~/lib/skill-tier";
import { SkillFormSchema } from "~/lib/skill-types";
import { SkillError, createSkill } from "~/lib/skills";

export async function loader(args: LoaderFunctionArgs) {
  requireUser(args.context, { role: "trainer" });
  return null;
}

export async function action(args: ActionFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const fd = await args.request.formData();
  const parsed = SkillFormSchema.safeParse({
    name: String(fd.get("name") ?? ""),
    description: String(fd.get("description") ?? ""),
    tier: fd.has("tier") ? String(fd.get("tier")) : undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Niepoprawne dane." };
  }
  try {
    const skill = await createSkill(
      api,
      parsed.data.name,
      parsed.data.description,
      parsed.data.tier,
    );
    throw redirect(`/trener/umiejetnosci/${skill.id}`);
  } catch (e) {
    if (e instanceof Response) throw e;
    // Zajęta nazwa (`409`) to zdanie w formularzu; każda inna odmowa BE idzie
    // na granicę błędu z kodem kontraktu, nie jako nieobsłużony wyjątek.
    if (e instanceof SkillError) return { error: e.userMessage };
    if (e instanceof ApiError) throw toRouteResponse(e);
    throw e;
  }
}

export default function NowaUmiejetnosc() {
  const actionData = useActionData<typeof action>();
  return (
    <div style={{ maxWidth: 560 }}>
      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Trener
          </div>
          <h1>Nowa umiejętność</h1>
        </div>
      </div>
      <Form method="post" className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
        <label className="col" style={{ gap: 4 }}>
          <span className="text-sm">Nazwa</span>
          <input
            name="name"
            className="input"
            maxLength={120}
            required
            placeholder="np. Front Lever"
          />
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="text-sm">Opis (opcjonalny)</span>
          <textarea name="description" className="input" maxLength={2000} rows={3} />
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="text-sm">Poziom trudności</span>
          <select name="tier" className="input" defaultValue="basic">
            {SKILL_TIERS.map((t) => (
              <option key={t} value={t}>
                {TIER_LABEL[t]}
              </option>
            ))}
          </select>
          <span className="text-xs muted">
            Decyduje, na którym pasie piramidy stanie ta umiejętność. Zmienisz w każdej chwili.
          </span>
        </label>
        {actionData != null && "error" in actionData && actionData.error != null && (
          <p role="alert" style={{ color: "var(--danger)", fontSize: 12, margin: 0 }}>
            {actionData.error}
          </p>
        )}
        <button type="submit" className="btn btn-primary">
          Utwórz
        </button>
      </Form>
    </div>
  );
}
