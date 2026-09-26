import { useEffect, useMemo, useState } from "react";
import {
  type ActionFunctionArgs,
  Form,
  type LoaderFunctionArgs,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { z } from "zod";
import { type ResolvedPair, SideBySideSection } from "~/components/body-photo-compare";
import { FileDropzone } from "~/components/file-dropzone";
import { Icons } from "~/components/icons";
import { ListControls } from "~/components/list-controls";
import { Modal } from "~/components/modal";
import { Pagination, parsePage } from "~/components/pagination";
import { PhotoCard } from "~/components/photo-card";
import { type LightboxPhoto, PhotoLightbox } from "~/components/photo-lightbox";
import { requireUser } from "~/lib/api/auth";
import { ApiError, toRouteResponse } from "~/lib/api/errors";
import {
  BodyPhotoError,
  type BodyPhotoSort,
  type BodyPhotoView,
  addBodyPhoto,
  deleteBodyPhoto,
  getSideBySidePhotoPairs,
  listAllMyBodyPhotos,
  listMyBodyPhotos,
} from "~/lib/body-photos";
import { UploadError, maxUploadBytesFor } from "~/lib/file-uploads";
import { todayISO } from "~/lib/format";
import { type ListControlsSpec, parseListControls } from "~/lib/list-params";

const UploadSchema = z.object({
  view: z.enum(["front", "side", "back"]),
  takenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z
    .string()
    .max(500)
    .optional()
    .transform((v) => v?.trim() || null),
});

const DELETE_ACTION_PATH = "/podopieczny/sylwetka";

const SYLWETKA_SPEC: ListControlsSpec = {
  sortOptions: [
    { key: "newest", label: "Najnowsze" },
    { key: "oldest", label: "Najstarsze" },
  ],
  defaultSort: "newest",
  filterGroups: [],
  searchable: false,
};

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainee" });
  const url = new URL(args.request.url);
  const page = parsePage(url.searchParams);

  const controls = parseListControls(url.searchParams, SYLWETKA_SPEC);

  // Dwa odczyty, nie jeden: siatka jest stronicowana po stronie BE (60/stronę,
  // `total`/`totalPages` w odpowiedzi, stronę spoza zakresu przycina on sam —
  // dawne `count` + `safePage` w tym loaderze znikły), a porównanie „przed / po"
  // musi widzieć WSZYSTKIE zdjęcia ujęcia, czego strona z definicji nie daje.
  const [strona, wszystkie] = await Promise.all([
    listMyBodyPhotos(api, { page, sort: controls.sort as BodyPhotoSort }),
    listAllMyBodyPhotos(api),
  ]);

  // Adnotacja typem komponentu jest tu bramką, nie ozdobą: pilnuje, że kształt
  // pary z modułu nadal pasuje do `SideBySideSection`.
  const resolvedPairs: ResolvedPair[] = getSideBySidePhotoPairs(wszystkie);

  return {
    // `photoUrl` z kontraktu ma już dołożony origin (robi to moduł) — trasa
    // wyłącznie przemianowuje pole na to, którego oczekują komponenty galerii.
    photos: strona.items.map((p) => ({
      id: p.id,
      view: p.view,
      takenOn: p.takenOn,
      note: p.note,
      url: p.photoUrl,
    })),
    page: strona.page,
    totalPages: strona.totalPages,
    total: strona.total,
    resolvedPairs,
    spec: SYLWETKA_SPEC,
    controls,
    // Z konfiguracji, nie na sztywno: `MAX_UPLOAD_BYTES` jest strojone przez env
    // („kalibrowalne bez redeployu"), więc zahardkodowana wartość rozjechałaby się
    // z serwerem przy pierwszej zmianie limitu.
    maxPhotoBytes: maxUploadBytesFor("body_photo"),
  };
}

export async function action(args: ActionFunctionArgs) {
  // Bez sprawdzania `user.trainerId`: było potrzebne wyłącznie po to, żeby podać
  // `trainerId` do zapisu. Właściciela zdjęcia wyznacza dziś token, a konto bez
  // trenera odbija BE własnym komunikatem.
  const { api } = requireUser(args.context, { role: "trainee" });
  const fd = await args.request.formData();
  const intent = fd.get("intent");

  if (intent === "delete") {
    const photoId = String(fd.get("photoId") ?? "");
    if (!photoId) return { error: "Brak id zdjęcia." };
    try {
      await deleteBodyPhoto(api, photoId);
    } catch (e) {
      if (e instanceof BodyPhotoError) return { error: e.userMessage };
      if (e instanceof ApiError) throw toRouteResponse(e);
      throw e;
    }
    return { ok: true };
  }

  // Default: upload
  const parsed = UploadSchema.safeParse({
    view: fd.get("view"),
    takenOn: fd.get("takenOn"),
    note: fd.get("note") ?? undefined,
  });
  if (!parsed.success) {
    return { error: "Sprawdź pola formularza." };
  }
  const fileBlob = fd.get("photo");
  if (!(fileBlob instanceof File) || fileBlob.size === 0) {
    return { error: "Wybierz zdjęcie." };
  }
  try {
    await addBodyPhoto(api, {
      file: fileBlob,
      view: parsed.data.view,
      takenOn: parsed.data.takenOn,
      note: parsed.data.note,
    });
  } catch (e) {
    // `UploadError` to odmowa PIERWSZEJ fazy (pusty plik, limit rozmiaru, typ
    // sprawdzany przez BE po zawartości), `BodyPhotoError` — DRUGIEJ (zapis
    // zdjęcia). Obie kończą się zdaniem w formularzu, więc trasa ich nie rozróżnia.
    if (e instanceof UploadError || e instanceof BodyPhotoError) return { error: e.userMessage };
    if (e instanceof ApiError) throw toRouteResponse(e);
    throw e;
  }
  return { ok: true };
}

type ViewFilter = "all" | BodyPhotoView;

export default function TraineeBodyGallery() {
  const { photos, page, totalPages, total, resolvedPairs, spec, controls, maxPhotoBytes } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  // Blokada podwójnej wysyłki — upload zdjęcia z telefonu trwa, a drugie kliknięcie
  // tworzy DRUGI wiersz `body_photos` i drugi blob na wolumenie (brak ograniczenia
  // unikalności w bazie).
  const navigation = useNavigation();
  const isSubmitting = navigation.formMethod != null;
  const [showAddModal, setShowAddModal] = useState(false);
  const [filter, setFilter] = useState<ViewFilter>("all");
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const uploadOk = actionData != null && "ok" in actionData && actionData.ok === true;
  useEffect(() => {
    if (uploadOk) {
      setShowAddModal(false);
      // Close lightbox after delete so we don't show a stale photo on the
      // refreshed list.
      setLightboxId(null);
    }
  }, [uploadOk]);

  const counts = useMemo(() => countByView(photos), [photos]);
  const filteredPhotos = useMemo(
    () => (filter === "all" ? photos : photos.filter((p) => p.view === filter)),
    [photos, filter],
  );

  // Lightbox navigation is always scoped to the clicked photo's VIEW (so
  // tapping a "tył" photo lets you swipe through other "tył" photos, even if
  // the gallery filter is "Wszystkie"). The filter only controls what's
  // visible in the grid.
  const activeLightboxPhotos: LightboxPhoto[] = useMemo(() => {
    if (lightboxId == null) return [];
    const opened = photos.find((p) => p.id === lightboxId);
    if (!opened) return [];
    return photos
      .filter((p) => p.view === opened.view)
      .map((p) => ({
        id: p.id,
        url: p.url,
        view: p.view,
        takenOn: p.takenOn,
        note: p.note,
        // Kontrakt nie niesie typu zawartości zdjęcia (`BodyPhotoDto` ma sam
        // `photoUrl`), a lightbox używał go WYŁĄCZNIE do rozszerzenia w nazwie
        // pobieranego pliku. Pusta wartość schodzi tam do domyślnego `.jpg` —
        // luka L S4-1.
        mimeType: "",
      }));
  }, [lightboxId, photos]);

  const groups = useMemo(() => groupByMonth(filteredPhotos), [filteredPhotos]);

  return (
    <div>
      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Podopieczny
          </div>
          <h1>Sylwetka</h1>
          <div className="sub">Wrzucaj cotygodniowe zdjęcia. Trener je widzi.</div>
        </div>
        <button type="button" onClick={() => setShowAddModal(true)} className="btn btn-primary">
          <Icons.Plus /> Dodaj zdjęcie
        </button>
      </div>

      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Dodaj zdjęcie sylwetki"
      >
        <Form method="post" encType="multipart/form-data">
          <div className="modal-body">
            <div className="grid grid-2" style={{ gap: 14 }}>
              <div className="field">
                <label htmlFor="bp-view">Ujęcie</label>
                <select id="bp-view" name="view" required defaultValue="front" className="select">
                  <option value="front">Przód</option>
                  <option value="side">Bok</option>
                  <option value="back">Tył</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="bp-date">Data</label>
                <input
                  id="bp-date"
                  name="takenOn"
                  type="date"
                  required
                  defaultValue={todayISO()}
                  className="input"
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="bp-note">Notatka (opcjonalna)</label>
              <input
                id="bp-note"
                name="note"
                type="text"
                maxLength={500}
                placeholder="np. waga 72.4 kg, energia 8/10"
                className="input"
              />
            </div>
            <FileDropzone
              name="photo"
              kind="image"
              label="Zdjęcie"
              required
              capture
              maxBytes={maxPhotoBytes}
            />
            {actionData != null && "error" in actionData && actionData.error != null && (
              <p role="alert" style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>
                {actionData.error}
              </p>
            )}
          </div>
          <div className="modal-foot">
            <button type="button" onClick={() => setShowAddModal(false)} className="btn btn-ghost">
              Anuluj
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              <Icons.Upload /> {isSubmitting ? "Wysyłanie…" : "Dodaj zdjęcie"}
            </button>
          </div>
        </Form>
      </Modal>

      {total === 0 ? (
        <div className="empty">
          <h3>Brak zdjęć</h3>
          <div>Dodaj pierwsze powyżej.</div>
        </div>
      ) : (
        <>
          <ListControls spec={spec} state={controls} />

          <SideBySideSection pairs={resolvedPairs} onOpenPhoto={setLightboxId} />

          <FilterTabs filter={filter} setFilter={setFilter} counts={counts} />

          {filteredPhotos.length === 0 ? (
            <div className="empty" style={{ marginTop: 12 }}>
              <h3>Brak zdjęć w tym ujęciu</h3>
              <div>Zmień filtr lub wgraj nowe.</div>
            </div>
          ) : (
            <PhotoGrid groups={groups} onOpenPhoto={setLightboxId} />
          )}

          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            totalLabel={total === 1 ? "zdjęcie" : "zdjęć"}
          />
        </>
      )}

      <PhotoLightbox
        photos={activeLightboxPhotos}
        currentId={lightboxId}
        onClose={() => setLightboxId(null)}
        onNavigate={setLightboxId}
        deleteAction={DELETE_ACTION_PATH}
      />
    </div>
  );
}

// ============================================================
// Filter tabs
// ============================================================

function FilterTabs({
  filter,
  setFilter,
  counts,
}: {
  filter: ViewFilter;
  setFilter: (f: ViewFilter) => void;
  counts: Record<ViewFilter, number>;
}) {
  const TABS: Array<{ key: ViewFilter; label: string }> = [
    { key: "all", label: "Wszystkie" },
    { key: "front", label: "Przód" },
    { key: "side", label: "Bok" },
    { key: "back", label: "Tył" },
  ];
  return (
    <div className="row wrap" style={{ gap: 6, marginBottom: 14 }}>
      {TABS.map((tab) => {
        const isActive = filter === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={isActive ? "btn btn-sm btn-dark" : "btn btn-sm"}
          >
            {tab.label}
            <span
              className="mono"
              style={{
                marginLeft: 8,
                fontSize: 10,
                opacity: 0.7,
              }}
            >
              {counts[tab.key] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// Grid grouped by month
// ============================================================

interface PhotoGroup {
  label: string;
  photos: Array<{
    id: string;
    url: string;
    takenOn: string;
    view: BodyPhotoView;
    note: string | null;
  }>;
}

function PhotoGrid({
  groups,
  onOpenPhoto,
}: {
  groups: PhotoGroup[];
  onOpenPhoto: (id: string) => void;
}) {
  return (
    <div className="col" style={{ gap: 18 }}>
      {groups.map((g) => (
        <div key={g.label}>
          <div
            className="mono"
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: ".1em",
              color: "var(--muted)",
              marginBottom: 8,
            }}
          >
            {g.label} · {g.photos.length}
          </div>
          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            {g.photos.map((p) => (
              <PhotoCard
                key={p.id}
                id={p.id}
                url={p.url}
                takenOn={p.takenOn}
                view={p.view}
                note={p.note}
                onOpen={onOpenPhoto}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function countByView(photos: Array<{ view: BodyPhotoView }>): Record<ViewFilter, number> {
  const out: Record<ViewFilter, number> = {
    all: photos.length,
    front: 0,
    side: 0,
    back: 0,
  };
  for (const p of photos) {
    out[p.view] += 1;
  }
  return out;
}

const MONTHS_PL = [
  "Styczeń",
  "Luty",
  "Marzec",
  "Kwiecień",
  "Maj",
  "Czerwiec",
  "Lipiec",
  "Sierpień",
  "Wrzesień",
  "Październik",
  "Listopad",
  "Grudzień",
];

function groupByMonth<
  T extends { id: string; url: string; takenOn: string; view: BodyPhotoView; note: string | null },
>(photos: T[]): PhotoGroup[] {
  // Arrives pre-sorted by takenOn from the loader (kierunek zależny od ?sort=); grupowanie zachowuje tę kolejność.
  const groups = new Map<string, PhotoGroup>();
  const order: string[] = [];
  for (const p of photos) {
    const d = new Date(p.takenOn);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const label = `${MONTHS_PL[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    let g = groups.get(key);
    if (!g) {
      g = { label, photos: [] };
      groups.set(key, g);
      order.push(key);
    }
    g.photos.push({
      id: p.id,
      url: p.url,
      takenOn: p.takenOn,
      view: p.view,
      note: p.note,
    });
  }
  return order.map((k) => groups.get(k)!);
}
