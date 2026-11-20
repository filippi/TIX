/* Reproducible TIX48 workload comparisons. MIT license; no dependencies. */
(function (root) {
  "use strict";
  const tix = typeof module !== "undefined" && module.exports ? require("./tix.js") : root.TIX;
  const SPAN = 2 ** 25, BASE = Math.floor(1735689600 * 4 / SPAN) * SPAN;
  const SHIFT = 15, STEP = 2 ** SHIFT, BINS = SPAN / STEP, BATCH = 8192;
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
  function prepare(count, progress = () => {}) {
    const timestamps = new Float64Array(count), codes = new BigUint64Array(count), values = new Int16Array(count);
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
  function run(count = 1000000, repeats = 3, progress = () => {}) {
    if (!Number.isInteger(count) || count < 1 || count > 1000000 || !Number.isInteger(repeats) || repeats < 1 || repeats > 7) throw Error("Use 1..1,000,000 observations and 1..7 repeats");
    const data = prepare(count, progress), times = {count: {}, grid: {}}, dateSetup = [];
    for (const task of Object.keys(times)) for (const method of methods) times[task][method.id] = [];
    let expected;
    for (let repeat = 0; repeat < repeats; repeat++) {
      const totals = {}, grids = {}, elapsed = {count: {}, grid: {}};
      for (const method of methods) {
        totals[method.id] = 0;
        grids[method.id] = {counts: new Uint32Array(BINS), sums: new Float64Array(BINS)};
        elapsed.count[method.id] = 0; elapsed.grid[method.id] = 0;
      }
      let dateMs = 0;
      for (let start = 0; start < count; start += BATCH) {
        const end = Math.min(start + BATCH, count), ms = data.timestamps.subarray(start, end);
        const cc = data.codes.subarray(start, end), values = data.values.subarray(start, end);
        const clock = performance.now(), dates = Array.from(ms, value => new Date(value));
        dateMs += performance.now() - clock;
        const inputs = {date: dates, unix_ms: ms, tix48: cc};
        const offset = (repeat + Math.floor(start / BATCH)) % 3;
        const order = methods.slice(offset).concat(methods.slice(0, offset));
        if (repeat === 0 && start === 0) for (const method of methods) {
          method.count(inputs[method.id]);
          method.grid(inputs[method.id], values, new Uint32Array(BINS), new Float64Array(BINS));
        }
        for (const method of order) {
          const began = performance.now(), answer = method.count(inputs[method.id]);
          elapsed.count[method.id] += performance.now() - began; totals[method.id] += answer;
        }
        for (const method of order.slice().reverse()) {
          const grid = grids[method.id], began = performance.now();
          method.grid(inputs[method.id], values, grid.counts, grid.sums);
          elapsed.grid[method.id] += performance.now() - began;
        }
        if (start % (BATCH * 8) === 0) progress({phase: "measure", repeat: repeat + 1, repeats, completed: start, total: count});
      }
      const reference = grids.unix_ms;
      if (totals.date !== totals.unix_ms || totals.tix48 !== totals.unix_ms) throw Error("Period counts disagree");
      for (const method of methods) for (let i = 0; i < BINS; i++) {
        if (grids[method.id].counts[i] !== reference.counts[i] || grids[method.id].sums[i] !== reference.sums[i]) throw Error("Grid counts or sums disagree");
      }
      const observations = reference.counts.reduce((a, b) => a + b, 0);
      if (observations !== count || (expected !== undefined && expected !== totals.unix_ms)) throw Error("Repeat totals changed");
      expected = totals.unix_ms;
      for (const task of Object.keys(times)) for (const method of methods) times[task][method.id].push(elapsed[task][method.id]);
      dateSetup.push(dateMs);
      if (repeat === repeats - 1) {
        const empty = reference.counts.reduce((a, b) => a + (b === 0 ? 1 : 0), 0);
        data.correctness = {matched: expected, observations, occupied_bins: BINS - empty, empty_bins: empty,
          value_sum: reference.sums.reduce((a, b) => a + b, 0), all_counts_and_sums_identical: true};
      }
    }
    const timings = {};
    for (const task of Object.keys(times)) {
      timings[task] = {};
      for (const method of methods) timings[task][method.id] = {median: median(times[task][method.id]), runs: times[task][method.id]};
    }
    return {parameters: {count, repeats, seed: 48, batch: BATCH, source_level: 42, query_level: 23, bin_level: 27,
      bins: BINS, bin_seconds: STEP / 4, start_utc: tix.formatUTC(BigInt(BASE)), span_seconds: SPAN / 4},
      preparation: {...data.setup, date_batch_creation_ms_per_pass: median(dateSetup)}, timings_ms: timings,
      correctness: data.correctness, memory: {input_array_payload_bytes: data.timestamps.byteLength + data.codes.byteLength + data.values.byteLength,
        date_objects_per_batch_max: BATCH, native_tix48_bytes_per_record: 6, uint64_tix48_bytes_per_record: 8, unix_int64_bytes_per_record: 8}};
  }
  const api = {run, prepare, methods, nextRandom, median, config: {SPAN, BASE, STEP, BINS, QUERY_START, QUERY_END, QUERY_MASK, QUERY_PREFIX}};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TIXBenchmark = api;
})(globalThis);
