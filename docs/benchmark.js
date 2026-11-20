/* Reproducible TIX48 workload comparisons. MIT license; no dependencies. */
(function (root) {
  "use strict";
  const tix = typeof module !== "undefined" && module.exports ? require("./tix.js") : root.TIX;
  const SPAN = 2 ** 25, BASE = Math.floor(1735689600 * 4 / SPAN) * SPAN;
  const SHIFT = 15, STEP = 2 ** SHIFT, BINS = SPAN / STEP, BATCH = 8192, DATE_BATCH = 65536, MAX_COUNT = 2000000;
  const MASK = (1n << 42n) - 1n, EPOCH = 1n << 41n;
  const QUERY_START = BASE + SPAN / 2, QUERY_END = QUERY_START + 2 ** 19;
  const QUERY_MASK = MASK ^ ((1n << 19n) - 1n);
  const QUERY_PREFIX = (BigInt(QUERY_START) + EPOCH) & QUERY_MASK;
  const BASE_PREFIX = Number((BigInt(BASE) + EPOCH) >> BigInt(SHIFT));
  function nextRandom(state) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return state >>> 0;
  }
  const methods = [
    {id: "date", count(items) {
      let hits = 0;
      for (let i = 0; i < items.length; i++) {
        const ms = items[i].getTime();
        if (ms >= QUERY_START * 250 && ms < QUERY_END * 250) hits++;
      }
      return hits;
    }, grid(items, values, counts, sums) {
      for (let i = 0; i < items.length; i++) {
        const bucket = Math.floor((items[i].getTime() - BASE * 250) / (STEP * 250));
        counts[bucket]++; sums[bucket] += values[i];
      }
    }},
    {id: "unix_ms", count(items) {
      let hits = 0;
      for (let i = 0; i < items.length; i++) if (items[i] >= QUERY_START * 250 && items[i] < QUERY_END * 250) hits++;
      return hits;
    }, grid(items, values, counts, sums) {
      for (let i = 0; i < items.length; i++) {
        const bucket = Math.floor((items[i] - BASE * 250) / (STEP * 250));
        counts[bucket]++; sums[bucket] += values[i];
      }
    }},
    {id: "tix48", count(items) {
      let hits = 0;
      for (let i = 0; i < items.length; i++) if ((items[i] & QUERY_MASK) === QUERY_PREFIX) hits++;
      return hits;
    }, grid(items, values, counts, sums) {
      for (let i = 0; i < items.length; i++) {
        const bucket = Number((items[i] & MASK) >> 15n) - BASE_PREFIX;
        counts[bucket]++; sums[bucket] += values[i];
      }
    }}
  ];
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  function prepare(count, progress = () => {}, storage) {
    const {timestamps, codes, values} = storage || {timestamps: new Float64Array(count), codes: new BigUint64Array(count), values: new Int16Array(count)};
    let state = 48, unixMs = 0, tixMs = 0;
    const began = performance.now();
    for (let start = 0; start < count; start += BATCH) {
      const length = Math.min(BATCH, count - start), ticks = new Float64Array(length);
      for (let i = 0; i < length; i++) {
        state = nextRandom(state);
        const offset = state & (SPAN - 1);
        ticks[i] = BASE + offset;
        values[start + i] = Math.round(1000 * Math.sin(2 * Math.PI * offset / (STEP * 64))) + (state >>> 25) - 64;
      }
      let clock = performance.now();
      for (let i = 0; i < length; i++) timestamps[start + i] = ticks[i] * 250;
      unixMs += performance.now() - clock;
      clock = performance.now();
      for (let i = 0; i < length; i++) codes[start + i] = tix.encode(BigInt(ticks[i]), 42);
      tixMs += performance.now() - clock;
      if (start % (BATCH * 8) === 0) progress({phase: "prepare", completed: start, total: count});
    }
    return {timestamps, codes, values, setup: {generation_and_encoding_ms: performance.now() - began,
      unix_ms_materialization_ms: unixMs, tix48_validated_encoding_ms: tixMs}};
  }
  // The public decoder stays BigInt-based. This benchmark additionally reads
  // each uint64 code as two little-endian words, avoiding per-record boxing.
  const wordMaskLo = Number(QUERY_MASK & 0xffffffffn) >>> 0, wordMaskHi = Number(QUERY_MASK >> 32n);
  const wordPrefixLo = Number(QUERY_PREFIX & 0xffffffffn) >>> 0, wordPrefixHi = Number(QUERY_PREFIX >> 32n);
  const wordMethod = {id: "tix_words", count(words) {
    let hits = 0;
    for (let i = 0; i < words.length; i += 2)
      if (((words[i] & wordMaskLo) >>> 0) === wordPrefixLo && (words[i + 1] & wordMaskHi) === wordPrefixHi) hits++;
    return hits;
  }, grid(words, values, counts, sums) {
    for (let i = 0; i < values.length; i++) {
      const bucket = (words[i * 2 + 1] & 1023) * 131072 + (words[i * 2] >>> 15) - BASE_PREFIX;
      counts[bucket]++; sums[bucket] += values[i];
    }
  }};
  function createWasmBackend(bytes, count) {
    if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) throw Error("Invalid WebAssembly record count");
    if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1) throw Error("The benchmark requires a little-endian host");
    const began = performance.now(), module = new WebAssembly.Module(bytes), instance = new WebAssembly.Instance(module);
    const compilationMs = performance.now() - began, e = instance.exports, align = n => Math.ceil(n / 8) * 8;
    const timesPtr = align(Number(e.__heap_base.value)), codesPtr = timesPtr + count * 8, valuesPtr = codesPtr + count * 8;
    const countsPtr = align(valuesPtr + count * 2), sumsPtr = countsPtr + BINS * 4, needed = sumsPtr + BINS * 8;
    if (needed > 64 * 1024 * 1024) throw Error("WebAssembly memory cap exceeded");
    const pages = Math.ceil(needed / 65536) - e.memory.buffer.byteLength / 65536;
    if (pages > 0) e.memory.grow(pages);
    const storage = {timestamps: new Float64Array(e.memory.buffer, timesPtr, count),
      codes: new BigUint64Array(e.memory.buffer, codesPtr, count), values: new Int16Array(e.memory.buffer, valuesPtr, count)};
    const output = {counts: new Uint32Array(e.memory.buffer, countsPtr, BINS), sums: new Float64Array(e.memory.buffer, sumsPtr, BINS)};
    const wasmMethods = [
      {id: "wasm_unix", count: () => e.count_unix(timesPtr, count, QUERY_START * 250, QUERY_END * 250),
        grid: () => e.grid_unix(timesPtr, valuesPtr, count, countsPtr, sumsPtr, BASE * 250, STEP * 250)},
      {id: "wasm_tix", count: () => e.count_tix(codesPtr, count, QUERY_MASK, QUERY_PREFIX),
        grid: () => e.grid_tix(codesPtr, valuesPtr, count, countsPtr, sumsPtr, BASE_PREFIX)}];
    return {storage, output, methods: wasmMethods, compilation_ms: compilationMs,
      memory_bytes: e.memory.buffer.byteLength, exports: e};
  }
  // Time repeated complete operations in one clock window. This avoids summing
  // hundreds of near-zero, individually quantized primitive-kernel timings.
  function measure(fn, targetMs = 40) {
    fn(); // warmup, outside the measured window
    let iterations = 1;
    for (;;) {
      let value;
      const began = performance.now();
      for (let i = 0; i < iterations; i++) value = fn();
      const elapsed = performance.now() - began;
      if (elapsed >= targetMs || iterations >= 4096)
        return {ms: elapsed / iterations, iterations, window_ms: elapsed, value};
      iterations = Math.min(4096, Math.max(iterations * 2, Math.ceil(iterations * targetMs / Math.max(elapsed, 0.1))));
    }
  }
  function run(count = 1000000, repeats = 3, progress = () => {}, options = {}) {
    if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT || !Number.isInteger(repeats) || repeats < 1 || repeats > 7) throw Error("Use 1..2,000,000 observations and 1..7 repeats");
    const backend = options.backend, data = prepare(count, progress, backend?.storage);
    const words = new Uint32Array(data.codes.buffer, data.codes.byteOffset, count * 2);
    const active = [...methods.slice(1), wordMethod, ...(backend?.methods || [])];
    const all = [methods[0], ...active], inputs = {unix_ms: data.timestamps, tix48: data.codes, tix_words: words};
    const output = backend?.output || {counts: new Uint32Array(BINS), sums: new Float64Array(BINS)};
    const times = {count: {}, grid: {}}, windows = {}, dateSetup = [];
    const target = options.targetMs === undefined ? 40 : options.targetMs;
    for (const method of all) {
      windows[method.id] = {count: [], grid: []};
      for (const task of Object.keys(times)) times[task][method.id] = [];
    }
    let correctness;
    function checkGrid(reference, candidate) {
      for (let i = 0; i < BINS; i++) if (reference.counts[i] !== candidate.counts[i] || reference.sums[i] !== candidate.sums[i]) throw Error("Grid counts or sums disagree");
    }
    for (let repeat = 0; repeat < repeats; repeat++) {
      let reference, expected;
      const order = active.slice(repeat % active.length).concat(active.slice(0, repeat % active.length));
      for (const method of order) {
        progress({phase: "measure", repeat: repeat + 1, repeats, method: method.id, completed: 0, total: count});
        const counting = measure(() => method.count(inputs[method.id]), target);
        if (expected !== undefined && expected !== counting.value) throw Error("Period counts disagree");
        expected = counting.value;
        const grid = measure(() => {
          output.counts.fill(0); output.sums.fill(0);
          method.grid(inputs[method.id], data.values, output.counts, output.sums);
        }, target);
        const snapshot = {counts: output.counts.slice(), sums: output.sums.slice()};
        if (reference) checkGrid(reference, snapshot); else reference = snapshot;
        times.count[method.id].push(counting.ms); times.grid[method.id].push(grid.ms);
        windows[method.id].count.push({iterations: counting.iterations, window_ms: counting.window_ms});
        windows[method.id].grid.push({iterations: grid.iterations, window_ms: grid.window_ms});
      }
      // Date is an object baseline, kept in bounded chunks to avoid retaining
      // two million objects. Calibrate each chunk instead of timing tiny loops.
      let hits = 0, dateMs = 0, countMs = 0, gridMs = 0;
      const dateGrid = {counts: new Uint32Array(BINS), sums: new Float64Array(BINS)};
      for (let start = 0; start < count; start += DATE_BATCH) {
        const end = Math.min(start + DATE_BATCH, count), began = performance.now();
        const dates = Array.from(data.timestamps.subarray(start, end), ms => new Date(ms));
        dateMs += performance.now() - began;
        const values = data.values.subarray(start, end), method = methods[0];
        const counting = measure(() => method.count(dates), Math.min(target, 10));
        const grid = measure(() => {
          output.counts.fill(0); output.sums.fill(0);
          method.grid(dates, values, output.counts, output.sums);
        }, Math.min(target, 10));
        hits += counting.value; countMs += counting.ms; gridMs += grid.ms;
        for (let i = 0; i < BINS; i++) {dateGrid.counts[i] += output.counts[i]; dateGrid.sums[i] += output.sums[i];}
      }
      if (hits !== expected) throw Error("Date period count disagrees");
      checkGrid(reference, dateGrid);
      times.count.date.push(countMs); times.grid.date.push(gridMs); dateSetup.push(dateMs);
      const observations = reference.counts.reduce((a, b) => a + b, 0);
      if (observations !== count) throw Error("Observation total changed");
      const empty = reference.counts.reduce((a, b) => a + (b === 0 ? 1 : 0), 0);
      correctness = {matched: expected, observations, occupied_bins: BINS - empty, empty_bins: empty,
        value_sum: reference.sums.reduce((a, b) => a + b, 0), all_counts_and_sums_identical: true};
    }
    const timings = {};
    for (const task of Object.keys(times)) {
      timings[task] = {};
      for (const method of all) timings[task][method.id] = {median: median(times[task][method.id]), runs: times[task][method.id]};
    }
    return {parameters: {count, repeats, seed: 48, batch: BATCH, date_batch: DATE_BATCH, source_level: 42, query_level: 23, bin_level: 27,
      bins: BINS, bin_seconds: STEP / 4, start_utc: tix.formatUTC(BigInt(BASE)), span_seconds: SPAN / 4},
      preparation: {...data.setup, wasm_compilation_and_instantiation_ms: backend?.compilation_ms || 0,
        date_batch_creation_ms_per_pass: median(dateSetup)}, timings_ms: timings, measurement_windows: windows,
      execution: {javascript: "Engine JIT, warmed", wasm: backend ? "C -O3 -msimd128; CPU WebAssembly" : "Unavailable / not requested",
        gpu: false, target_window_ms: target, shared_input_buffers: !!backend, date_baseline: "Calibrated chunks, different cache pattern"},
      correctness, memory: {input_array_payload_bytes: data.timestamps.byteLength + data.codes.byteLength + data.values.byteLength,
        wasm_linear_memory_bytes: backend?.memory_bytes || 0, wasm_memory_cap_bytes: 64 * 1024 * 1024,
        date_objects_per_batch_max: DATE_BATCH, native_tix48_bytes_per_record: 6, uint64_tix48_bytes_per_record: 8, unix_int64_bytes_per_record: 8}};
  }
  const api = {run, prepare, methods, wordMethod, createWasmBackend, measure, nextRandom, median, config: {SPAN, BASE, STEP, BINS, QUERY_START, QUERY_END, QUERY_MASK, QUERY_PREFIX}};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TIXBenchmark = api;
})(globalThis);
