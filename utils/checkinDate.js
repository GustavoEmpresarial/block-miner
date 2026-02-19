const CHECKIN_TIMEZONE = "America/Sao_Paulo";
const CHECKIN_RESET_HOUR = 21;

function getBrazilDateParts(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHECKIN_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });

  const parts = formatter.formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: Number(map.hour || 0)
  };
}

function formatBrazilDateKey(date) {
  const { year, month, day } = getBrazilDateParts(date);
  return `${year}-${month}-${day}`;
}

function getBrazilCheckinDateKey(now = new Date()) {
  const { hour } = getBrazilDateParts(now);
  if (hour < CHECKIN_RESET_HOUR) {
    const previousDay = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return formatBrazilDateKey(previousDay);
  }

  return formatBrazilDateKey(now);
}

module.exports = {
  getBrazilCheckinDateKey
};
