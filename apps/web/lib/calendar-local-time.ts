function zonedParts(
  date: Date,
  timeZone: string
) {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }
    ).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter(
        (part) =>
          part.type !==
          "literal"
      )
      .map((part) => [
        part.type,
        part.value
      ])
  ) as Record<
    string,
    string
  >;
}

export function toLocalInput(
  iso: string,
  timeZone: string
): string {
  const parts =
    zonedParts(
      new Date(iso),
      timeZone
    );

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function wallTimeToIso(
  value: string,
  timeZone: string
): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(
      value
    );

  if (!match) {
    throw new Error(
      "INVALID_LOCAL_TIME"
    );
  }

  const [
    ,
    year,
    month,
    day,
    hour,
    minute
  ] = match;

  const desiredUtc =
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      0
    );

  let candidate =
    desiredUtc;

  for (
    let attempt = 0;
    attempt < 3;
    attempt += 1
  ) {
    const parts =
      zonedParts(
        new Date(candidate),
        timeZone
      );

    const representedUtc =
      Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second)
      );

    candidate +=
      desiredUtc -
      representedUtc;
  }

  const validation =
    zonedParts(
      new Date(candidate),
      timeZone
    );

  const normalized =
    `${validation.year}-${validation.month}-${validation.day}T${validation.hour}:${validation.minute}`;

  if (
    normalized !== value
  ) {
    throw new Error(
      "LOCAL_TIME_DOES_NOT_EXIST"
    );
  }

  return new Date(
    candidate
  ).toISOString();
}
