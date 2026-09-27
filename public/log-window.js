export function createLogWindow(limit = 500) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('El límite de líneas debe ser positivo');
  let lines = [];
  let end = 0;

  const visible = () => lines.slice(Math.max(0, end - limit), end);
  return {
    append(batch, { follow = true } = {}) {
      lines.push(...(Array.isArray(batch) ? batch : [batch]).map(String));
      if (follow) end = lines.length;
    },
    replace(nextLines, { follow = true } = {}) {
      lines = Array.from(nextLines, String);
      end = follow ? lines.length : Math.min(end, lines.length);
    },
    previous() { end = Math.max(limit, end - limit); return visible(); },
    next() { end = Math.min(lines.length, end + limit); return visible(); },
    follow() { end = lines.length; return visible(); },
    visible,
    canPrevious: () => end > limit,
    canNext: () => end < lines.length,
    total: () => lines.length,
    end: () => end,
  };
}
