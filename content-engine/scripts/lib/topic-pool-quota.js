/**
 * Daily Shortlist cap for Content Topic Pool (Europe/Berlin calendar day by default).
 */

const DEFAULT_TZ = process.env.CONTENT_TZ || "Europe/Berlin";

export function getTodayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Count Topic Pool rows with Status = Shortlisted and Shortlisted on = today (YYYY-MM-DD).
 */
export async function countShortlistedToday(dbId, shortlistedOnProp, notionQuery) {
  const day = getTodayYmd();
  const filter = {
    and: [
      { property: "Status", select: { equals: "Shortlisted" } },
      { property: shortlistedOnProp, date: { equals: day } },
    ],
  };
  const res = await notionQuery(dbId, filter, undefined, 100);
  return res.results.length;
}

export function remainingSlots(dailyCap, promotedToday) {
  return Math.max(0, dailyCap - promotedToday);
}
