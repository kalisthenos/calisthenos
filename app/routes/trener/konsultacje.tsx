import { useState } from "react";
import { type LoaderFunctionArgs, useLoaderData } from "react-router";
import { ConsultationRow } from "~/components/consultation-row";
import { type DaySummary, MonthCalendar } from "~/components/month-calendar";
import { requireUser } from "~/lib/api/auth";
import { consultationPresentation, mostUrgentTone } from "~/lib/consultation-status";
import {
  type ConsultationView,
  appWallClockNow,
  listOccurrencesInRange,
} from "~/lib/consultations";
import { fmtTime, monthRangeUTC, shiftMonth, todayISO } from "~/lib/format";

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const url = new URL(args.request.url);
  const m = url.searchParams.get("m") ?? todayISO().slice(0, 7);
  const range = monthRangeUTC(m);
  // Ten sam `GET /v1/consultations` co u podopiecznego: trener dostaje z niego
  // terminy WSZYSTKICH swoich podopiecznych (nazwa w `trainee`), bez odwołanych.
  const occurrences = await listOccurrencesInRange(api, range);
  return { occurrences, m, year: range.year, month0: range.month0, today: todayISO() };
}

export default function TrenerKonsultacjeKalendarz() {
  const { occurrences, m, year, month0, today } = useLoaderData<typeof loader>();
  // `scheduledAt` przychodzi z modułu w konwencji czasu ŚCIENNEGO, więc „teraz"
  // musi być w tej samej — `Date.now()` myliłby się o offset strefy (D-FE-3).
  const now = appWallClockNow();

  // Grupuj po dniu miesiąca (UTC).
  const byDay = new Map<number, ConsultationView[]>();
  for (const o of occurrences) {
    const day = new Date(o.scheduledAt).getUTCDate();
    const arr = byDay.get(day) ?? [];
    arr.push(o);
    byDay.set(day, arr);
  }

  // Podsumowanie per dzień dla kalendarza (kolor = najważniejszy ton).
  const days = new Map<number, DaySummary>();
  for (const [day, occs] of byDay) {
    const tones = occs.map(
      (o) =>
        consultationPresentation({
          status: o.status,
          scheduledAtISO: o.scheduledAt,
          nowMs: now,
          viewer: "trainer",
        }).tone,
    );
    const tone = mostUrgentTone(tones);
    if (tone) days.set(day, { tone, count: occs.length });
  }

  const todayDay = today.slice(0, 7) === m ? new Date(`${today}T00:00:00.000Z`).getUTCDate() : null;
  const firstDayWithOcc = [...byDay.keys()].sort((a, b) => a - b)[0] ?? null;
  const [selected, setSelected] = useState<number | null>(firstDayWithOcc);
  const selectedOccs = selected != null ? (byDay.get(selected) ?? []) : [];

  return (
    <div>
      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Trener
          </div>
          <h1>Konsultacje</h1>
          <div className="sub">
            Zbiorczy kalendarz wszystkich terminów z podopiecznymi — dobierz wolny slot.
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 760 }}>
        <MonthCalendar
          year={year}
          month0={month0}
          todayDay={todayDay}
          days={days}
          selected={selected}
          onSelect={setSelected}
          prevHref={`?m=${shiftMonth(m, -1)}`}
          nextHref={`?m=${shiftMonth(m, 1)}`}
        />

        <div style={{ marginTop: 18 }}>
          {selectedOccs.length > 0 ? (
            <div className="list">
              {selectedOccs.map((o) => {
                const meta = consultationPresentation({
                  status: o.status,
                  scheduledAtISO: o.scheduledAt,
                  nowMs: now,
                  viewer: "trainer",
                });
                return (
                  <ConsultationRow
                    key={o.id}
                    to={`/trener/podopieczni/${o.trainee.id}/konsultacje/${o.id}`}
                    lead={fmtTime(o.scheduledAt)}
                    title={o.trainee.displayName}
                    sub={`${o.durationMin} min`}
                    label={meta.label}
                    tone={meta.tone}
                  />
                );
              })}
            </div>
          ) : (
            <div className="empty">
              <h3>{occurrences.length === 0 ? "Brak terminów w tym miesiącu" : "Wybierz dzień"}</h3>
              <div>
                {occurrences.length === 0
                  ? "Użyj strzałek, aby przejść do innego miesiąca, albo ustaw harmonogram u podopiecznego."
                  : "Dni z umówionymi terminami są oznaczone kropką."}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
