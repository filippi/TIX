/* Run only on request, in a disposable worker. No dataset lives on the page. */
"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const names = {date: "Date.getTime()", unix_ms: "Unix milliseconds", tix48: "TIX48 prefix"};
  let worker = null, lastPhase = "";
  function stop() {
    if (worker) worker.terminate();
    worker = null; $("bench-run").disabled = false; $("bench-size").disabled = false;
    $("bench-cancel").hidden = true; $("bench-progress").hidden = true;
  }
  function renderTask(task, result) {
    const values = result.timings_ms[task], rows = Object.keys(names);
    const fastest = rows.reduce((a, b) => values[a].median <= values[b].median ? a : b);
    const max = Math.max(...rows.map(id => values[id].median), 0.001);
    const body = $("bench-" + task + "-rows"); body.replaceChildren();
    for (const id of rows) {
      const row = document.createElement("tr"), label = document.createElement("th"), cell = document.createElement("td");
      label.scope = "row"; label.textContent = names[id];
      cell.className = "bench-time";
      const bar = document.createElement("span"); bar.className = "bench-bar";
      bar.style.width = `${values[id].median / max * 100}%`; bar.setAttribute("aria-hidden", "true");
      const text = document.createElement("span"); text.className = "bench-ms";
      text.textContent = `${values[id].median.toFixed(2)} ms`;
      cell.append(bar, text); row.append(label, cell);
      if (id === fastest) {row.className = "bench-fastest"; label.textContent += " · fastest";}
      body.append(row);
    }
    $("bench-" + task + "-summary").textContent = task === "count"
      ? `${result.correctness.matched.toLocaleString("en-US")} observations matched. All three methods agree.`
      : `${result.correctness.occupied_bins.toLocaleString("en-US")} occupied bins; ${result.correctness.empty_bins} empty. Every bin’s count and sum match exactly.`;
  }
  function complete(result) {
    renderTask("count", result); renderTask("grid", result);
    const p = result.preparation;
    $("bench-setup").textContent = `Preparation, outside the timed kernels: generation + encoding ${p.generation_and_encoding_ms.toFixed(1)} ms (including Unix array ${p.unix_ms_materialization_ms.toFixed(1)} ms and validated TIX encoding ${p.tix48_validated_encoding_ms.toFixed(1)} ms). Date batch creation adds ${p.date_batch_creation_ms_per_pass.toFixed(1)} ms per pass.`;
    const n = result.parameters.count, mb = bytes => (bytes / 1000000).toFixed(2) + " MB";
    $("bench-packed").textContent = mb(n * 6);
    $("bench-tix-memory").textContent = mb(n * 8);
    $("bench-unix-memory").textContent = mb(n * 8);
    $("bench-memory-note").textContent = `${mb(result.memory.input_array_payload_bytes)} of input array payloads for both time representations plus values. At most 8,192 Date objects per batch. Headers, temporary objects and browser heap overhead are additional; this is not peak memory.`;
    $("bench-status").textContent = `Complete · ${n.toLocaleString("en-US")} observations · median of 3 passes · identical results verified.`;
    $("bench-results").hidden = false; stop();
  }
  $("bench-run").addEventListener("click", () => {
    if (worker) return;
    try {
      if (typeof Worker === "undefined") throw Error("This browser cannot run the worker benchmark. Try a current browser over HTTP or HTTPS.");
      worker = new Worker("benchmark-worker.js");
      const active = worker;
      $("bench-run").disabled = true; $("bench-size").disabled = true;
      $("bench-cancel").hidden = false; $("bench-progress").hidden = false;
      $("bench-progress").value = 0; $("bench-results").hidden = true;
      $("bench-status").textContent = "Preparing matched observations…"; lastPhase = "";
      worker.onmessage = event => {
        if (worker !== active) return;
        const message = event.data;
        if (message.type === "done") {complete(message.result); return;}
        if (message.type === "error") {$("bench-status").textContent = "Benchmark failed: " + message.message; stop(); return;}
        if (message.type === "progress") {
          const phase = message.phase + (message.repeat || "");
          if (phase !== lastPhase) {
            $("bench-status").textContent = message.phase === "prepare" ? "Preparing matched observations…" : `Measuring pass ${message.repeat} of ${message.repeats}…`;
            lastPhase = phase;
          }
          $("bench-progress").value = message.phase === "prepare" ? 0.2 * message.completed / message.total
            : 0.2 + 0.8 * ((message.repeat - 1) + message.completed / message.total) / message.repeats;
        }
      };
      worker.onerror = () => {if (worker !== active) return; $("bench-status").textContent = "The benchmark worker could not finish. Try the smaller dataset."; stop();};
      worker.postMessage({count: Number($("bench-size").value)});
    } catch (error) {$("bench-status").textContent = error.message; stop();}
  });
  $("bench-cancel").addEventListener("click", () => {stop(); $("bench-status").textContent = "Benchmark cancelled.";});
})();
