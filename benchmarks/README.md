# Reproduce the prepared-data comparisons

```sh
python3 benchmarks/benchmark.py --count 2000000 --repeats 3 --output /tmp/tix-python.json
node benchmarks/benchmark.js 2000000 > /tmp/tix-javascript-wasm.json
```

The [page](https://filippi.github.io/TIX/#benchmarks) runs the same kernels in a
disposable worker. Choose 100,000, one million, or two million records. There is
no automatic benchmark, dataset transfer to the main thread, or GPU computation.

**Processing and conversion are separate.** Generate one set of random times
and observation values, then materialize equivalent numeric timestamps and
TIX48 codes. Encode and validate once, before timing. During measurement each
kernel processes its own prepared primitive representation. The JavaScript and
WASM implementations read the **same backing buffers**; no copying or encoding
occurs in their timed loops. Date object construction is also outside timing.
Preparation and WASM compilation/instantiation are reported separately.

## Current two-million-record reference run

These are individual arm64 runs on 20 November 2026, not general speed guarantees:
[Python 3.14.2](python-results-2m.json), [Node v25.2.1 with WASM](javascript-wasm-results.json).
Browser results depend on the visitor's engine, device and timer resolution.

| Implementation | Count points in a period (ms) | Regular binning of timestamps (ms) |
| --- | ---: | ---: |
| Date.getTime(), bounded batches | 16.564 | 3.912 |
| JavaScript Unix milliseconds | 8.287 | 3.589 |
| JavaScript TIX48 BigInt | 1.613 | 31.798 |
| JavaScript TIX48 uint32 words | 1.715 | 3.928 |
| WASM SIMD Unix milliseconds | 0.467 | 1.930 |
| WASM SIMD TIX48 | 0.455 | 1.130 |

The two WASM counting times are close; do not infer a meaningful advantage from
that small difference. The benefit of avoiding boxed BigInt operations is most
visible in binning. Both numeric timestamps and TIX receive the same C compiler
optimization flags. These measurements do not establish that TIX is inherently
faster than an integer timestamp. The Date baseline has a different cache pattern
because it is deliberately chunked to bound object memory.

Python uses its standard library and the earlier batched timing harness. Its
current two-million run measured period counting at 50.91 ms (datetime), 70.16 ms
(Unix milliseconds) and 73.10 ms (TIX); binning took 337.84, 251.29 and 217.50 ms,
respectively. Cross-runtime timings are not a controlled compiler comparison.

The earlier one-million [Python](python-results.json) and
[JavaScript](javascript-results.json) snapshots are retained as historical data.
The historical JS harness summed tiny batch durations; the current calibrated
whole-array harness replaces it. Do not compare ratios across the two harnesses.

## Inputs and operations

A fixed xorshift32 seed (48) generates unsorted quarter-second observations over
a `2**25`-quarter-second window, starting at `2024-10-04T14:47:28Z`. Values are a
rounded sinusoid plus deterministic noise. Every method receives the same times
and values. TIX48 source cells are L42, finer than the query and output bins.

1. **Count points in a period:** count records in one aligned L23 cell
   (131,072 seconds), with `[start,end)` bounds or a precompiled TIX prefix mask.
   All records are L42; mixed levels would also require level checks and an
   explicit containment/overlap policy.
2. **Regular binning of timestamps:** accumulate each value and count into one
   of 1,024 aligned L27 cells (8,192 seconds each). Means can be derived from
   sum/count where count is nonzero. Empty bins remain missing observations.

For two million records, every implementation finds **31,159** query matches,
all **1,024** bins are occupied, and the aggregate value sum is **−2,351,935**.
Each run compares every bin's count and sum across methods, not just checksums.
Tests additionally exercise exact boundaries, missing bins, high-word prefix
mismatches, coarse clock calibration, WASM fallback and worker cancellation.

Repeated queries over sorted numeric timestamps with binary search, or a
preaggregated index, can outperform any full scan. TIX is an interval encoding,
not automatically an index.

## Optimizations and timing

JavaScript uses the runtime's normal optimizing JIT, with warmup and no forced
engine flags. The generic TIX path uses BigInt; a second path reads each uint64
as two uint32 words, preserving all 42 time-prefix bits and avoiding BigInt
arithmetic in the inner loop. The general-purpose decoder remains BigInt-based.

[WASM kernels](kernels.c) are compiled with **`-O3 -msimd128` for both Unix and
TIX**, using Zig 0.17.1's Clang/LLVM toolchain. The emitted counting loops contain
SIMD instructions in both paths. The histogram loops update scattered bins;
SIMD-enabled compilation is not a claim that every instruction in every kernel
is vectorized. WASM is CPU execution, not a GPU experiment. If it cannot load,
the page runs JavaScript only and explicitly reports the reason.

The shipped [module](../docs/benchmark.wasm) is 885 bytes and has no imports.
No compiler or package is needed to use the website. Rebuild optionally with a
Zig compiler (the first argument can be the path to its executable):

```sh
sh benchmarks/build-wasm.sh /path/to/zig
```

This is a benchmark implementation, not a separately linked TIX library. The
reusable C library remains the single `tix.h` header.

Each primitive measurement warms the kernel, then repeats complete array scans
inside one clock window of at least 40 ms (subject to a 4,096-iteration cap for
tiny test datasets). Divide the window duration by its iteration count to report
a single-scan time. Use three such measurements, rotating method order, and show
the median. Histograms are reset inside each timed operation for every method;
no aggregate is reused as a cached answer. Counts and bins are checked afterwards.
Raw window lengths and iteration counts are saved in the JSON report.

The Date object baseline instead uses at most 65,536 objects at a time. Each
chunk is warmed and repeated in a calibrated window of up to 10 ms target before
its normalized time is added to the whole-dataset result. This avoids retaining
two million Date objects, but differs in working-set/cache behavior. Date
construction is excluded and reported per pass. Browser clock precision can be
coarsened; small differences remain subject to noise. See the
[High Resolution Time specification](https://www.w3.org/TR/hr-time-3/).

For a one-off task, include preparation costs. Stored codes or repeated processing
can amortize them. General numeric time representations can also use dyadic
arithmetic; this is not an exclusive capability of TIX.

## Memory and interval compactness

Two million records use **36,000,000 bytes of input payload**: eight bytes each
for the numeric timestamp and uint64 TIX code, plus two bytes for each common
observation value. With WASM, these arrays reside once in shared linear memory
(no SharedArrayBuffer or second dataset is needed). This run allocated
37,093,376 bytes of WASM memory, including its stack and histograms, with a
hard 64 MiB WASM-memory cap. Date batches, array headers, temporary objects and
runtime heap/GC are additional. These are not peak-process-memory measurements.
The worker is terminated on completion or cancellation.

| An aligned dyadic interval | Payload per record | Two million records |
| --- | ---: | ---: |
| Start timestamp + duration, two int64 fields | 16 bytes | 32 MB |
| TIX48, packed native bytes | 6 bytes | 12 MB |
| TIX48, actual uint64/BigUint64Array | 8 bytes | 16 MB |
| Timestamp alone, actual numeric array | 8 bytes | 16 MB |

One TIX carries position **and** interval level. Arbitrary start/duration pairs
can describe intervals that one TIX cell cannot; an exact TIX cover may need
several cells. Packed-six-byte and paired-field sizes are calculated, not
allocated or timed by this benchmark. A custom timestamp can also be packed.

On this Python runtime, `sys.getsizeof` reports 48 bytes for the aware datetime
and 40 for timedelta, versus 32 for a TIX integer. Those 88/32-byte comparisons
exclude any container, shared timezone object or allocator overhead and do not
represent native serialized sizes. Precision and supported interval shapes also
differ. The measurements are included in the Python JSON.

## Spectral analysis and other scalar domains

The grid workload prepares sums/counts for time-series analysis. **No FFT is
timed.** An ordinary FFT takes a regular sequence; binning changes the signal,
so bin width, aggregation, weighting and missing-bin treatment need a deliberate
choice. A coarse observation interval cannot be assigned to finer bins without
additional assumptions. See [NumPy's DFT documentation](https://numpy.org/doc/stable/reference/routines.fft.html)
and [SciPy's Lomb–Scargle documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.lombscargle.html).

The hierarchy itself is a general dyadic primitive for scalar ranges. Altitude,
radiance or another bounded scalar can use the structure with explicit domain
bounds, origin, units, transforms and resolution. The implemented TIX convention
is time-specific; other quantities need their own convention and metadata.
