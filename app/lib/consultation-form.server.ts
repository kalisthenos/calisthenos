/**
 * Parsery FormData → surowe obiekty do walidacji Zodem (ConsultationDocFormSchema
 * / ScheduleFormSchema). Punkty: równoległe pola `itemBody[]` + `itemStatus[]`.
 */
export function parseConsultationDocFormData(fd: FormData) {
  const bodies = fd.getAll("itemBody").map((v) => String(v));
  const statuses = fd.getAll("itemStatus").map((v) => String(v));
  const items = bodies
    .map((body, i) => ({ body, status: statuses[i] === "resolved" ? "resolved" : "open" }))
    .filter((it) => it.body.trim().length > 0);
  const meetingUrl = String(fd.get("meetingUrl") ?? "").trim() || null;
  return {
    scheduledAt: String(fd.get("scheduledAt") ?? ""),
    durationMin: String(fd.get("durationMin") ?? "45"),
    meetingUrl,
    summary: String(fd.get("summary") ?? ""),
    items,
  };
}

export function parseScheduleFormData(fd: FormData) {
  const cadence = String(fd.get("cadence") ?? "");
  const weekdayRaw = String(fd.get("weekday") ?? "").trim();
  const domRaw = String(fd.get("dayOfMonth") ?? "").trim();
  const url = String(fd.get("defaultMeetingUrl") ?? "").trim() || null;
  return {
    cadence,
    weekday: weekdayRaw === "" ? null : Number(weekdayRaw),
    dayOfMonth: domRaw === "" ? null : Number(domRaw),
    timeOfDay: String(fd.get("timeOfDay") ?? ""),
    durationMin: String(fd.get("durationMin") ?? "45"),
    startsOn: String(fd.get("startsOn") ?? ""),
    defaultMeetingUrl: url,
  };
}
