"use strict";
(() => {
  const $ = id => document.getElementById(id);
  let bits = 48, language = "python", live = true, editing = false, model;
  let current = TIX.fromUnixMilliseconds(BigInt(Date.now()), 40), anchor;
  const durationText = ticks => {
    const seconds = Number(ticks) * 2 ** (46 - bits);
    if (seconds < 0.001) return `${Number((seconds * 1e6).toPrecision(12))} µs`;
    if (seconds < 1) return `${seconds} s`;
    if (seconds === 1) return "1 second";
    if (seconds < 86400) return `${seconds.toLocaleString("en-US")} seconds`;
    if (seconds < 31557600) return `${Number((seconds / 86400).toPrecision(4))} days`;
    return `≈ ${(seconds / 31557600).toLocaleString("en-US", {maximumFractionDigits: 1})} years`;
  };
  function liveState() {
    $("live-button").setAttribute("aria-pressed", String(live));
    $("live-label").textContent = live ? "Live · pause" : "Live time";
  }
  function focusLevel(level) {
    show(live ? TIX.fromUnixMilliseconds(BigInt(Date.now()), level, bits) : TIX.encode(anchor, level, bits));
  }
  function keyboard(event, code) {
    const d = TIX.decode(code, bits), epoch = 1n << BigInt(bits - 7);
    let target;
    if (event.key === "ArrowUp" && d.level) target = TIX.parent(code, d.level - 1, bits);
    if (event.key === "ArrowDown" && d.level < bits - 6) target = TIX.children(code, bits)[0];
    if (event.key === "ArrowLeft" && d.start > -epoch) target = TIX.encode(d.start - 1n, d.level, bits);
    if (event.key === "ArrowRight" && d.end < epoch) target = TIX.encode(d.end, d.level, bits);
    if (target !== undefined) {
      event.preventDefault(); show(target);
      $("timeline-rows").querySelector('[aria-current="true"]')?.focus();
    }
  }
  function drawRows() {
    const rows = $("timeline-rows"); rows.replaceChildren();
    for (const row of model.rows) {
      const element = document.createElement("div");
      element.className = "timeline-row" + (row.level === model.selected.level ? " current-row" : "");
      element.dataset.level = String(row.level);
      const label = document.createElement("button");
      label.type = "button"; label.className = "row-label";
      label.setAttribute("aria-label", `Focus level ${row.level}, ${durationText(row.duration)}`);
      const name = document.createElement("strong"); name.textContent = `L${row.level}`;
      const duration = document.createElement("span"); duration.textContent = durationText(row.duration);
      label.append(name, duration); label.onclick = () => focusLevel(row.level);
      label.onkeydown = event => keyboard(event, row.focus);
      const track = document.createElement("div"); track.className = "row-track";
      for (const cell of row.cells) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "time-cell" + (cell.related ? " related" : "") +
          (cell.selected ? " selected-cell" : "") + (cell.clippedLeft ? " clipped-left" : "") +
          (cell.clippedRight ? " clipped-right" : "");
        button.style.left = `${cell.x}%`; button.style.width = `${cell.width}%`;
        button.dataset.code = TIX.toHex(cell.code, bits);
        button.tabIndex = cell.selected ? 0 : -1;
        button.title = `L${row.level} · ${durationText(row.duration)}\n[${TIX.formatUTC(cell.start, bits)}, ${TIX.formatUTC(cell.end, bits)})\n${TIX.toHex(cell.code, bits)}`;
        button.setAttribute("aria-label", button.title.replace(/\n/g, " "));
        if (cell.selected) button.setAttribute("aria-current", "true");
        if (cell.width >= 12) {
          const text = document.createElement("span");
          text.textContent = cell.selected ? "Selected" : durationText(row.duration);
          button.append(text);
        }
        button.onclick = () => show(cell.code);
        button.onkeydown = event => keyboard(event, cell.code);
        track.append(button);
      }
      element.append(label, track); rows.append(element);
    }
  }
  function show(code, follow = false) {
    const d = TIX.decode(code, bits);
    live = follow; current = code;
    anchor = d.start + (d.end - d.start) / 2n;
    model = TIXTimeline.layout(code, bits, anchor);
    liveState();
    $("error").hidden = true; $("code-input").removeAttribute("aria-invalid");
    if (!editing) $("code-input").value = TIX.toHex(code, bits);
    $("width").value = String(bits);
    $("input-hint").textContent = `TIX${bits} · ${Math.ceil(bits / 4)} lowercase hex digits or 11 unpadded Base64url characters.`;
    $("duration").textContent = durationText(d.end - d.start);
    $("level-badge").textContent = `TIX${bits} · L${d.level}`;
    $("start").textContent = TIX.formatUTC(d.start, bits);
    $("end").textContent = TIX.formatUTC(d.end, bits);
    $("hex").textContent = TIX.toHex(code, bits); $("base64").textContent = TIX.toBase64(code, bits);
    $("level-limit").textContent = d.level + 5 >= bits - 6 ? `TIX${bits} ends at L${bits - 6}` : "Every split halves the duration";
    if (!live) $("selection-status").textContent = `Selected level ${d.level}, ${durationText(d.end - d.start)}, ${TIX.formatUTC(d.start, bits)}`;
    drawRows(); updateClock();
  }
  function updateClock() {
    $("time-cursor").hidden = !live;
    $("clock").textContent = live ? new Date(Date.now()).toISOString().replace("T", " ") : "PAUSED · EXPLORING AN INTERVAL";
    if (!live) return;
    const numerator = BigInt(Date.now()) * (1n << BigInt(bits - 6));
    const denominator = 1000n * (1n << 40n);
    const percent = Number((2n * numerator - model.start2 * denominator) * 1000000n / (model.span2 * denominator)) / 10000;
    $("time-cursor").style.left = `${percent}%`;
  }
  $("decode-form").addEventListener("submit", event => {
    event.preventDefault();
    try {
      const text = $("code-input").value.trim();
      const code = text.length === 11 ? TIX.fromBase64(text, bits) : TIX.fromHex(text, bits);
      editing = false; show(code);
    } catch (exc) {
      live = false; liveState(); updateClock();
      $("error").textContent = exc.message; $("error").hidden = false;
      $("code-input").setAttribute("aria-invalid", "true");
    }
  });
  $("code-input").addEventListener("focus", () => {editing = true;});
  $("code-input").addEventListener("blur", () => {editing = false;});
  $("width").addEventListener("change", () => {
    const next = Number($("width").value), shift = next - bits;
    const ticks = shift >= 0 ? anchor << BigInt(shift) : anchor >> BigInt(-shift);
    const level = Math.min(model.selected.level, next - 6), follow = live;
    bits = next; show(TIX.encode(ticks, level, bits), follow);
  });
  $("live-button").addEventListener("click", () => {
    if (live) {live = false; liveState(); updateClock(); return;}
    editing = false;
    show(TIX.fromUnixMilliseconds(BigInt(Date.now()), Math.min(40, bits - 6), bits), true);
  });
  setInterval(() => {
    if (!live) return;
    const code = TIX.fromUnixMilliseconds(BigInt(Date.now()), model.selected.level, bits);
    if (code !== current) show(code, true);
    else updateClock();
  }, 100);

  function source(lang) {
    language = lang;
    const python = lang === "python";
    $("source-code").textContent = TIX_SOURCES[python ? "tix.py" : "tix.h"];
    $("copy-source").textContent = python ? "Copy Python" : "Copy C header";
    $("source-hint").textContent = python
      ? "Complete tix.py. Core times use integer quarter-seconds by default. Use encode_seconds() for Unix seconds."
      : "Complete tix.h. All functions are static inline. Default ticks are quarter-seconds. Define TIX_BITS before inclusion for another width.";
    for (const [id, selected] of [["python-tab", python], ["c-tab", !python]]) {
      $(id).classList.toggle("active", selected); $(id).setAttribute("aria-pressed", String(selected));
    }
    $("copy-status").textContent = "";
  }
  $("python-tab").addEventListener("click", () => source("python"));
  $("c-tab").addEventListener("click", () => source("c"));
  $("copy-source").addEventListener("click", async () => {
    const text = TIX_SOURCES[language === "python" ? "tix.py" : "tix.h"];
    try {
      await navigator.clipboard.writeText(text);
      $("copy-status").textContent = language === "python" ? "Python implementation copied." : "C header copied.";
    } catch {
      const range = document.createRange(); range.selectNodeContents($("source-code"));
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      $("copy-status").textContent = "Clipboard access is unavailable. The complete code is selected; use your browser’s Copy command.";
    }
  });
  source("python"); show(current, true);
})();
