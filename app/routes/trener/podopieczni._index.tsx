import { useEffect, useState } from "react";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { z } from "zod";
import { CopyButton } from "~/components/copy-button";
import { Icons } from "~/components/icons";
import { ListControls } from "~/components/list-controls";
import { Modal } from "~/components/modal";
import { OnboardingPicker } from "~/components/onboarding-picker";
import { Pagination, parsePage } from "~/components/pagination";
import { requireUser } from "~/lib/api/auth";
import { ApiError, toRouteResponse } from "~/lib/api/errors";
import { InviteError, createInvite } from "~/lib/auth";
import { getEnv } from "~/lib/env";
import { listActiveExercisesForTrainer } from "~/lib/exercises";
import { daysAgo, pluralizePl, type PlForms } from "~/lib/format";
import { parseListControls, type ListControlsSpec } from "~/lib/list-params";
import { OnboardingTemplateSchema } from "~/lib/onboarding-form-types";
import { listClientsForTrainer, type ClientSort, type PlanFilter } from "~/lib/trainees";

const OSOBA: PlForms = { one: "osoba", few: "osoby", many: "osób" };

const InviteSchema = z.object({
  displayName: z.string().trim().min(1, "Podaj imię i nazwisko.").max(80),
  email: z
    .string()
    .trim()
    .min(1, "Email jest wymagany.")
    .max(254)
    .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
      message: "Nieprawidłowy email.",
    }),
});

const spec: ListControlsSpec = {
  sortOptions: [
    { key: "name_asc", label: "Nazwisko A–Z" },
    { key: "name_desc", label: "Nazwisko Z–A" },
    { key: "last_session", label: "Ostatnia sesja" },
    { key: "most_sessions", label: "Najwięcej sesji" },
    { key: "newest", label: "Najnowszy podopieczny" },
  ],
  defaultSort: "name_asc",
  filterGroups: [
    {
      param: "plan",
      label: "Plan",
      options: [
        { value: "all", label: "Wszyscy" },
        { value: "with", label: "Z aktywnym planem" },
        { value: "without", label: "Bez planu" },
      ],
      defaultValue: "all",
    },
  ],
  searchable: true,
};

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const url = new URL(args.request.url);
  const page = parsePage(url.searchParams);
  const deletedName = url.searchParams.get("usuniety");

  const controls = parseListControls(url.searchParams, spec);
  const plan = (controls.filters.plan ?? "all") as PlanFilter;

  // Jedno żądanie zamiast dwóch: strona przychodzi razem z `total`, a `page`
  // spoza zakresu przycina BE — dawne `safePage` nie ma już czego liczyć.
  const result = await listClientsForTrainer(api, {
    page,
    sort: controls.sort as ClientSort,
    q: controls.q,
    plan,
  });

  // Biblioteka do pickera formularza startowego. Ciągniemy ją w loaderze zamiast
  // osobnym fetcherem — kilka KB na wejście, a modal działa bez dodatkowej rundy.
  const exercises = await listActiveExercisesForTrainer(api);

  return {
    clients: result.items,
    spec,
    controls,
    page: result.page,
    totalPages: result.totalPages,
    total: result.total,
    deletedName,
    exercises,
  };
}

export async function action(args: ActionFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const fd = await args.request.formData();

  const parsed = InviteSchema.safeParse({
    displayName: fd.get("displayName"),
    email: fd.get("email"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Sprawdź formularz." };
  }

  const wantsForm = fd.get("withOnboarding") === "on";
  let template: { exerciseIds: string[]; note: string | null } | null = null;
  if (wantsForm) {
    const parsedTemplate = OnboardingTemplateSchema.safeParse({
      exerciseIds: fd.getAll("onboardingExercise").map(String),
      note: String(fd.get("onboardingNote") ?? ""),
    });
    if (!parsedTemplate.success) {
      return { error: parsedTemplate.error.issues[0]?.message ?? "Sprawdź formularz." };
    }
    template = parsedTemplate.data;
  }

  let token: string;
  try {
    // Zaproszenie Z formularzem albo nic — atomowo po stronie BE, jednym
    // `POST /v1/invites`. Trener wynika z tokenu, nie z ciała.
    ({ token } = await createInvite(api, {
      displayName: parsed.data.displayName,
      email: parsed.data.email,
      onboardingForm: template,
    }));
  } catch (e) {
    if (e instanceof InviteError) return { error: e.userMessage };
    if (e instanceof ApiError) throw toRouteResponse(e);
    throw e;
  }

  // Odnośnik składany z `token`, nie z `url` odpowiedzi: BE buduje
  // `{APP_PUBLIC_URL}/join/{token}`, a FE przyjmuje zaproszenia pod
  // `/zaproszenie/:token` (luka L S2-1 — do rozstrzygnięcia poza tą trasą).
  const inviteUrl = `${getEnv().BASE_URL}/zaproszenie/${token}`;
  return {
    invite: {
      url: inviteUrl,
      displayName: parsed.data.displayName,
      email: parsed.data.email,
      withOnboarding: template != null,
    },
  };
}

export default function TrenerPodopieczniList() {
  const { clients, spec, controls, page, totalPages, total, deletedName, exercises } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [showInviteModal, setShowInviteModal] = useState(false);

  const hasInvite = actionData != null && "invite" in actionData && actionData.invite != null;

  // Auto-close the modal once an invite is successfully created — the result
  // card takes over below.
  useEffect(() => {
    if (hasInvite) setShowInviteModal(false);
  }, [hasInvite]);

  return (
    <div>
      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Trener
          </div>
          <h1>Podopieczni</h1>
          <div className="sub">
            {total === 0
              ? "Brak podopiecznych. Wygeneruj pierwsze zaproszenie."
              : `${total} ${pluralizePl(total, OSOBA)}.`}
          </div>
        </div>
        <button type="button" onClick={() => setShowInviteModal(true)} className="btn btn-primary">
          <Icons.Plus /> Zaproś podopiecznego
        </button>
      </div>

      {deletedName != null && deletedName.length > 0 && (
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
          Podopieczny „{deletedName}" został usunięty wraz ze wszystkimi danymi.
        </output>
      )}

      {hasInvite && actionData != null && "invite" in actionData && actionData.invite != null && (
        <InviteCreatedCard invite={actionData.invite} />
      )}

      <Modal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title="Zaproś podopiecznego"
      >
        <Form method="post">
          <div className="modal-body">
            <div className="field">
              <label htmlFor="inv-name">Imię i nazwisko</label>
              <input
                id="inv-name"
                name="displayName"
                type="text"
                required
                maxLength={80}
                placeholder="np. Mateusz Kozłowski"
                className="input"
                ref={(el) => {
                  // Focus the first field when the modal mounts.
                  el?.focus();
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="inv-email">Email</label>
              <input
                id="inv-email"
                name="email"
                type="email"
                required
                maxLength={254}
                placeholder="mateusz@example.pl"
                className="input"
              />
            </div>
            <OnboardingPicker exercises={exercises} />
            {actionData != null && "error" in actionData && actionData.error != null && (
              <p role="alert" style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>
                {actionData.error}
              </p>
            )}
          </div>
          <div className="modal-foot">
            <button
              type="button"
              onClick={() => setShowInviteModal(false)}
              className="btn btn-ghost"
            >
              Anuluj
            </button>
            <button type="submit" className="btn btn-primary">
              <Icons.Link /> Wygeneruj link
            </button>
          </div>
        </Form>
      </Modal>

      <ListControls
        spec={spec}
        state={controls}
        searchPlaceholder="Szukaj po nazwisku lub emailu…"
      />

      {total === 0 ? null : (
        <div className="list">
          <div
            className="list-head"
            style={{ display: "grid", gridTemplateColumns: "2fr 1.4fr 1.2fr 0.4fr", gap: 14 }}
          >
            <div>Podopieczny</div>
            <div>Aktywny plan</div>
            <div>Ostatnia sesja</div>
            <div />
          </div>
          {clients.map((c) => (
            <Link
              key={c.id}
              to={`/trener/podopieczni/${c.id}`}
              className="list-row"
              style={{ gridTemplateColumns: "2fr 1.4fr 1.2fr 0.4fr", gap: 14 }}
            >
              <div className="row" style={{ gap: 10 }}>
                <span className="avatar sm">{initialsOf(c.displayName)}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{c.displayName}</div>
                </div>
              </div>
              <div>
                {c.hasActivePlan ? (
                  <span className="badge active">
                    <span className="badge-dot" />
                    aktywny plan
                  </span>
                ) : (
                  <span className="text-xs muted">brak aktywnego planu</span>
                )}
              </div>
              <div className="text-sm">
                {c.lastSessionOn ? (
                  <span className="muted">ostatnia {daysAgo(c.lastSessionOn)}</span>
                ) : (
                  <span className="muted">brak sesji</span>
                )}
                {c.sessionCount > 0 && (
                  <span className="muted" style={{ marginLeft: 6 }}>
                    · <span className="mono">{c.sessionCount}</span>
                  </span>
                )}
              </div>
              <div style={{ textAlign: "right", color: "var(--muted-2)" }}>
                <Icons.Chev />
              </div>
            </Link>
          ))}
        </div>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        totalLabel={pluralizePl(total, OSOBA)}
      />
    </div>
  );
}

function InviteCreatedCard({
  invite,
}: {
  invite: { url: string; displayName: string; email: string | null; withOnboarding: boolean };
}) {
  return (
    <div
      className="card"
      style={{
        background: "var(--ink)",
        color: "var(--bg)",
        border: 0,
        marginBottom: 20,
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 10,
          color: "var(--accent)",
          textTransform: "uppercase",
          letterSpacing: ".1em",
          marginBottom: 6,
        }}
      >
        Link wygenerowany · ważny 14 dni
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>
        {invite.displayName}
        {invite.email != null && (
          <span style={{ opacity: 0.6, fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
            ({invite.email})
          </span>
        )}
      </div>
      {invite.withOnboarding && (
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>
          Z formularzem startowym — podopieczny wypełni go po założeniu konta.
        </div>
      )}
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 12 }}>
        Skopiuj i wyślij podopiecznemu. Po przyjęciu zaproszenia konto pojawi się na liście poniżej.
      </div>
      <div className="row" style={{ gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
        <div
          className="mono"
          style={{
            background: "rgba(255,255,255,.08)",
            padding: "10px 12px",
            borderRadius: 8,
            fontSize: 12.5,
            wordBreak: "break-all",
            userSelect: "all",
            flex: 1,
            minWidth: 0,
          }}
        >
          {invite.url}
        </div>
        <CopyButton value={invite.url} variant="primary" label="Kopiuj link" />
      </div>
      <div className="mono" style={{ fontSize: 11, opacity: 0.6, marginTop: 10 }}>
        Token pokazujemy tylko teraz. Jeśli zgubisz link, wygeneruj nowy.
      </div>
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}
