"use strict";
(() => {
  const $ = id => document.getElementById(id);
  let bits = 48, current = TIX.fromHex("8201a262a000"), language = "python";
  const formatDuration = (ticks, width) => {
    const seconds = Number(ticks) * 2 ** (46 - width);
    if (seconds < 0.001) return `${Number((seconds * 1e6).toPrecision(12))} microseconds`;
    if (seconds < 1) return `${seconds} seconds`;
    if (seconds === 1) return "1 second";
    if (seconds < 86400) return `${seconds.toLocaleString("en-US")} seconds`;
    return `${seconds.toLocaleString("en-US")} seconds · ${seconds >= 31557600 ? "≈ " + (seconds / 31557600).toLocaleString("en-US", {maximumFractionDigits: 1}) + " years" : (seconds / 86400).toLocaleString("en-US", {maximumFractionDigits: 2}) + " days"}`;
  };
  function navigation(id, code, label, disabledText) {
    const button = $(id);
    button.replaceChildren();
    button.disabled = code === null;
    const add = (className, text) => {
      const span = document.createElement("span");
      span.className = className; span.textContent = text; button.append(span);
    };
    add("nav-label", label);
    if (code === null) {
      add("nav-time", disabledText); button.onclick = null; return;
    }
    const d = TIX.decode(code, bits);
    add("nav-code", TIX.toHex(code, bits));
    add("nav-time", `L${d.level} · ${formatDuration(d.end - d.start, bits)}`);
    button.onclick = () => show(code);
  }
  function show(code) {
    const d = TIX.decode(code, bits), p = bits - 6;
    current = code;
    $("error").hidden = true; $("result").hidden = false;
    $("code-input").removeAttribute("aria-invalid");
    $("code-input").value = TIX.toHex(code, bits);
    $("width").value = String(bits);
    $("input-hint").textContent = `${Math.ceil(bits / 4)} lowercase hex digits or 11 unpadded Base64url characters. Width must match the original format.`;
    $("duration").textContent = formatDuration(d.end - d.start, bits);
    $("level-badge").textContent = `TIX${bits} · L${d.level}`;
    $("start").textContent = TIX.formatUTC(d.start, bits);
    $("end").textContent = TIX.formatUTC(d.end, bits);
    $("integer").textContent = code.toString();
    $("hex").textContent = TIX.toHex(code, bits);
    $("base64").textContent = TIX.toBase64(code, bits);
    $("level-input").max = String(p);
    $("level-input").value = String(d.level);
    navigation("parent", d.level ? TIX.parent(code, d.level - 1, bits) : null,
      "PARENT · COARSER", "Level 0 covers the entire domain.");
    const kids = d.level < p ? TIX.children(code, bits) : [null, null];
    kids.forEach((c, i) => navigation(`child-${i}`, c, `CHILD ${i + 1} · FINER`, `Level ${p} is the finest level for TIX${bits}.`));
  }
  function error(exc, codeError = false) {
    $("error").textContent = exc.message; $("error").hidden = false;
    $("result").hidden = true;
    if (codeError) $("code-input").setAttribute("aria-invalid", "true");
  }
  $("decode-form").addEventListener("submit", event => {
    event.preventDefault();
    try {
      const text = $("code-input").value;
      show(text.length === 11 ? TIX.fromBase64(text, bits) : TIX.fromHex(text, bits));
    } catch (exc) { error(exc, true); }
  });
  $("width").addEventListener("change", () => {
    const d = TIX.decode(current, bits), next = Number($("width").value);
    const shift = next - bits;
    const ticks = shift >= 0 ? d.start << BigInt(shift) : d.start >> BigInt(-shift);
    bits = next;
    show(TIX.encode(ticks, Math.min(d.level, bits - 6), bits));
  });
  $("encode-form").addEventListener("submit", event => {
    event.preventDefault();
    try {
      const text = $("utc-input").value, ms = Date.parse(text + "Z");
      if (!Number.isFinite(ms)) throw Error("Enter a valid UTC date and time");
      show(TIX.fromUnixMilliseconds(BigInt(ms), Number($("level-input").value), bits));
    } catch (exc) { error(exc); }
  });
  document.querySelectorAll("[data-example]").forEach(button => {
    button.addEventListener("click", () => {
      bits = 48;
      const codes = {known: TIX.fromHex("8201a262a000"), epoch: TIX.encode(0n, 40),
        negative: TIX.encode(-1n, 42), universe: 0n};
      show(codes[button.dataset.example]);
    });
  });
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
  source("python"); show(current);
})();
