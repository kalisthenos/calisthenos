import { useEffect, useRef } from "react";
import {
  type ActionFunctionArgs,
  Form,
  type LoaderFunctionArgs,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { FeatureRequestBadge } from "~/components/feature-request-badge";
import { ListControls } from "~/components/list-controls";
import { Pagination, parsePage } from "~/components/pagination";
import { requireUser } from "~/lib/api/auth";
import { ApiError, toRouteResponse } from "~/lib/api/errors";
import {
  FEATURE_REQUEST_KINDS,
  FEATURE_REQUEST_STATUSES,
  FeatureRequestFormSchema,
  KIND_LABEL,
  STATUS_LABEL,
  canTraineeDelete,
} from "~/lib/feature-request-types";
import {
  FeatureRequestError,
  type FeatureRequestSort,
  type FeatureRequestStatusFilter,
  createFeatureRequest,
  deleteFeatureRequest,
  listForTrainee,
} from "~/lib/feature-requests";
import { type PlForms, fmtDate, pluralizePl } from "~/lib/format";
import { type ListControlsSpec, parseListControls } from "~/lib/list-params";

const ZGLOSZENIE: PlForms = { one: "zgłoszenie", few: "zgłoszenia", many: "zgłoszeń" };

const spec: ListControlsSpec = {
  sortOptions: [
    { key: "newest", label: "Najnowsze" },
    { key: "oldest", label: "Najstarsze" },
  ],
  defaultSort: "newest",
  filterGroups: [
    {
      param: "status",
      label: "Status",
      options: [
        { value: "all", label: "Wszystkie" },
        ...FEATURE_REQUEST_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
      ],
      defaultValue: "all",
    },
  ],
  searchable: false,
};

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainee" });
  const url = new URL(args.request.url);
  const page = parsePage(url.searchParams);
  const controls = parseListControls(url.searchParams, spec);
  const status = controls.filters.status as FeatureRequestStatusFilter;

  // Jedno żądanie zamiast dwóch: strona przychodzi razem z `total`, a `page`
  // spoza zakresu przycina BE — dawne `safePage` nie ma już czego liczyć.
  const result = await listForTrainee(api, {
    page,
    sort: controls.sort as FeatureRequestSort,
    status,
  });

  return {
    requests: result.items,
    spec,
    controls,
    page: result.page,
    totalPages: result.totalPages,
    total: result.total,
  };
}

export async function action(args: ActionFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainee" });

  const fd = await args.request.formData();
  const intent = String(fd.get("intent") ?? "");

  if (intent === "delete") {
    const id = String(fd.get("id") ?? "");
    try {
      await deleteFeatureRequest(api, id);
      return { ok: "Zgłoszenie usunięte.", error: null };
    } catch (e) {
      if (e instanceof FeatureRequestError) return { ok: null, error: e.userMessage };
      if (e instanceof ApiError) throw toRouteResponse(e);
      throw e;
    }
  }

  const parsed = FeatureRequestFormSchema.safeParse({
    kind: fd.has("kind") ? String(fd.get("kind")) : undefined,
    title: String(fd.get("title") ?? ""),
    body: String(fd.get("body") ?? ""),
  });
  if (!parsed.success) {
    return { ok: null, error: parsed.error.issues[0]?.message ?? "Niepoprawne dane." };
  }

  // Trener wynika z konta autora po stronie BE, nigdy z ładunku (`docs/04`) —
  // dawne sprawdzenie „podopieczny bez trenera → 404" przeszło tam razem z zapisem.
  try {
    await createFeatureRequest(api, {
      kind: parsed.data.kind,
      title: parsed.data.title,
      body: parsed.data.body,
    });
  } catch (e) {
    if (e instanceof FeatureRequestError) return { ok: null, error: e.userMessage };
    if (e instanceof ApiError) throw toRouteResponse(e);
    throw e;
  }
  return { ok: "Wysłane. Trener zobaczy to zgłoszenie.", error: null, created: true };
}

export default function PomyslyPodopiecznego() {
  const { requests, spec, controls, page, totalPages, total } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  // Pola są niekontrolowane, więc po udanym zapisie zostają wypełnione i kolejne
  // kliknięcie wysyła to samo zgłoszenie drugi raz. Czyścimy je po `created`
  // (nowy obiekt `actionData` przy każdym zapisie, więc efekt odpala za każdym).
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (actionData != null && "created" in actionData) formRef.current?.reset();
  }, [actionData]);

  return (
    <div>
      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Podopieczny
          </div>
          <h1>Pomysły</h1>
          <div className="sub">
            Masz pomysł na usprawnienie aplikacji albo trafiłeś na błąd? Napisz — trener to zobaczy.
          </div>
        </div>
      </div>

      <Form
        method="post"
        ref={formRef}
        className="card"
        style={{ display: "grid", gap: 12, marginBottom: 22 }}
      >
        <div className="row wrap" style={{ gap: 12 }}>
          <label className="col" style={{ gap: 4, width: 150 }}>
            <span className="text-sm">Typ</span>
            <select name="kind" className="input" defaultValue="idea">
              {FEATURE_REQUEST_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="col" style={{ gap: 4, flex: 1, minWidth: 200 }}>
            <span className="text-sm">Tytuł</span>
            <input
              name="title"
              className="input"
              maxLength={120}
              required
              placeholder="np. Przypomnienie o treningu"
            />
          </label>
        </div>
        <label className="col" style={{ gap: 4 }}>
          <span className="text-sm">Opis</span>
          <textarea
            name="body"
            className="input"
            rows={4}
            maxLength={2000}
            required
            placeholder="Napisz, co chcesz zmienić i dlaczego. Im konkretniej, tym lepiej."
          />
        </label>
        {actionData?.error != null && (
          <p role="alert" style={{ color: "var(--danger)", fontSize: 12, margin: 0 }}>
            {actionData.error}
          </p>
        )}
        {actionData?.ok != null && (
          <output style={{ color: "var(--ok)", fontSize: 12 }}>{actionData.ok}</output>
        )}
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Wysyłam…" : "Wyślij zgłoszenie"}
          </button>
        </div>
      </Form>

      <ListControls spec={spec} state={controls} />

      {total === 0 ? (
        <div className="empty">
          <h3>Brak zgłoszeń</h3>
          <div>Twoje pomysły pojawią się tutaj razem z odpowiedzią trenera.</div>
        </div>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          {requests.map((r) => (
            <article key={r.id} className="card" style={{ display: "grid", gap: 10 }}>
              <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
                <span className="badge">{KIND_LABEL[r.kind]}</span>
                <FeatureRequestBadge status={r.status} />
                <span style={{ flex: 1 }} />
                <span className="text-xs muted mono">{fmtDate(r.createdAt)}</span>
              </div>
              <h3 style={{ margin: 0, fontSize: 15 }}>{r.title}</h3>
              <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>{r.body}</p>

              {r.trainerResponse != null && (
                <div
                  className="col"
                  style={{
                    gap: 4,
                    padding: 12,
                    borderRadius: "var(--radius)",
                    background: "var(--surface-2)",
                    border: "1px solid var(--line)",
                  }}
                >
                  <span className="uppercase-label" style={{ color: "var(--muted)" }}>
                    Odpowiedź trenera
                    {r.respondedAt != null && ` · ${fmtDate(r.respondedAt)}`}
                  </span>
                  <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>
                    {r.trainerResponse}
                  </p>
                </div>
              )}

              {canTraineeDelete(r.status) && (
                <Form method="post">
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" className="btn btn-sm" disabled={busy}>
                    Usuń
                  </button>
                </Form>
              )}
            </article>
          ))}
        </div>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        totalLabel={pluralizePl(total, ZGLOSZENIE)}
      />
    </div>
  );
}
