const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const SHANGHAI_OFFSET = '+08:00';
const dateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHANGHAI_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hourCycle: 'h23',
});

export function formatShanghaiTimestamp(value, fallback = new Date()) {
  const candidate = value == null ? fallback : value instanceof Date ? value : new Date(value);
  const date = Number.isNaN(candidate.getTime()) ? fallback : candidate;
  const parts = Object.fromEntries(dateTimeFormatter.formatToParts(date).map(({ type, value: partValue }) => [type, partValue]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}${SHANGHAI_OFFSET}`;
}
