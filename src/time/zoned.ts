export type LocalDateTime = {
  date: string;
  time: string;
};

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function parseDate(date: string): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return undefined;
  }
  return { year, month, day };
}

function parseTime(time: string): { hour: number; minute: number } | undefined {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return undefined;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function partsAt(epochMs: number, timeZone: string): LocalParts {
  const values = new Map(
    formatter(timeZone)
      .formatToParts(new Date(epochMs))
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
  };
}

function sameParts(left: LocalParts, right: LocalParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

export function resolveLocalDateTime(
  date: string,
  time: string,
  timeZone: string,
): { ok: true; epochMs: number } | { ok: false; error: string } {
  const parsedDate = parseDate(date);
  const parsedTime = parseTime(time);
  if (!parsedDate) return { ok: false, error: "Invalid calendar date." };
  if (!parsedTime) return { ok: false, error: "Invalid local time." };

  const desired: LocalParts = { ...parsedDate, ...parsedTime };
  const desiredAsUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
  );

  let candidate = desiredAsUtc;
  try {
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const observed = partsAt(candidate, timeZone);
      const observedAsUtc = Date.UTC(
        observed.year,
        observed.month - 1,
        observed.day,
        observed.hour,
        observed.minute,
      );
      const correction = desiredAsUtc - observedAsUtc;
      if (correction === 0) break;
      candidate += correction;
    }

    if (!sameParts(partsAt(candidate, timeZone), desired)) {
      return {
        ok: false,
        error: "This local time does not exist in the configured timezone (DST transition).",
      };
    }

    // During an autumn DST fold the same wall clock time can occur twice.
    // Pick the earlier instant deterministically.
    for (const alternate of [candidate - 60 * 60_000, candidate + 60 * 60_000]) {
      if (sameParts(partsAt(alternate, timeZone), desired)) candidate = Math.min(candidate, alternate);
    }
    return { ok: true, epochMs: candidate };
  } catch {
    return { ok: false, error: `Invalid timezone: ${timeZone}` };
  }
}

export function localDateTimeAt(epochMs: number, timeZone: string): LocalDateTime {
  const parts = partsAt(epochMs, timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
  };
}

export function addCalendarDays(date: string, days: number): string {
  const parsed = parseDate(date);
  if (!parsed) throw new Error(`Invalid calendar date: ${date}`);
  const value = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}
