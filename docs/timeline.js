/* Exact dyadic layout for the TIX explorer. MIT license. */
(function (root) {
  "use strict";
  const tix = typeof module !== "undefined" && module.exports ? require("./tix.js") : root.TIX;
  const floorDiv = (a, b) => a >= 0n ? a / b : -((-a + b - 1n) / b);
  function layout(code, bits = 48, anchor) {
    const selected = tix.decode(code, bits), p = bits - 6;
    const duration = selected.end - selected.start, epoch = 1n << BigInt(p - 1);
    anchor = anchor === undefined ? selected.start + duration / 2n : anchor;
    if (typeof anchor !== "bigint" || anchor < selected.start || anchor >= selected.end) throw Error("Anchor must lie inside the selected interval");
    // Doubled ticks preserve half-tick viewport coordinates even at leaf levels.
    const start2 = selected.start * 2n - 3n * duration, span2 = 8n * duration;
    const end2 = start2 + span2;
    const percent = value2 => Number((value2 - start2) * 1000000n / span2) / 10000;
    const rows = [];
    for (let level = Math.max(0, selected.level - 5); level <= Math.min(p, selected.level + 5); level++) {
      const size = 1n << BigInt(p - level), limit = 1n << BigInt(level);
      let index = floorDiv(start2 + 2n * epoch, 2n * size);
      if (index < 0n) index = 0n;
      const cells = [];
      while (index < limit) {
        const start = index * size - epoch, end = start + size;
        if (start * 2n >= end2) break;
        const cell = (BigInt(level) << BigInt(p)) | (index * size);
        const left2 = start * 2n < start2 ? start2 : start * 2n;
        const right2 = end * 2n > end2 ? end2 : end * 2n;
        cells.push({code: cell, start, end, x: percent(left2), width: percent(right2) - percent(left2),
          clippedLeft: start * 2n < start2, clippedRight: end * 2n > end2,
          related: start < selected.end && end > selected.start, selected: cell === code});
        index++;
      }
      rows.push({level, duration: size, focus: tix.encode(anchor, level, bits), cells});
    }
    return {selected, duration, anchor, start2, end2, span2, rows, percent};
  }
  const api = {layout};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TIXTimeline = api;
})(globalThis);
