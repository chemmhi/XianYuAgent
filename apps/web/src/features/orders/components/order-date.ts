const orderDateParts = (value: string, timeZone?: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
};

/**
 * Order timestamps are stored as ISO instants. Format them in the browser's
 * local timezone instead of stripping the UTC offset and showing server time.
 * The optional timezone keeps the conversion deterministic in unit tests.
 */
export function formatOrderDate(value: string, timeZone?: string): string {
  if (!value || value.startsWith('1970-')) return '—';
  return orderDateParts(value, timeZone) ?? value;
}
