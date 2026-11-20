# Reproduce the TIX48 comparisons

```sh
python3 benchmarks/benchmark.py --count 1000000 --repeats 3 --output /tmp/tix-python.json
node benchmarks/benchmark.js 1000000 > /tmp/tix-javascript.json
```

Both use only their runtime's standard library. The page runs the same JavaScript
kernels in a disposable Web Worker, only when requested. Its 100,000-record
option is available for smaller devices; the maximum is one million.

The checked-in results are individual runs, not general speed guarantees:
[Python](python-results.json), [Node](javascript-results.json). Both ran on arm64
on 20 November 2026. Python was 3.14.2; Node was v25.2.1. Browser results will
depend on the visitor's engine, device, scheduling and timer precision.

| One million observations, median milliseconds | Python datetime | Python Unix ms | Python TIX48 |
| --- | ---: | ---: | ---: |
| Count within an L23 interval | 25.42 | 34.81 | 36.67 |
| Group into L27 bins, counts and sums | 169.04 | 118.80 | 103.12 |

| Same data, median milliseconds | JS Date.getTime() | JS Unix ms | JS TIX48 BigInt |
| --- | ---: | ---: | ---: |
| Count within an L23 interval | 4.30 | 3.78 | 0.54 |
| Group into L27 bins, counts and sums | 2.00 | 1.82 | 15.60 |

TIX wins some of these kernels and loses others. In particular, the JavaScript
BigInt-to-bin conversion is substantially slower than arithmetic on numeric
millisecond timestamps in this run. Do not describe TIX as inherently faster
than an integer timestamp, or reuse these ratios as browser measurements.

## Inputs and correctness

A fixed xorshift32 seed (48) generates one million unsorted quarter-second
observations over a `2**25`-quarter-second window, starting at
`2024-10-04T14:47:28Z`. Values are a rounded sinusoid plus deterministic noise.
The arrays contain the same times and values for every method. Encoding is
TIX48 L42, so source time cells are finer than either query or output bin.

1. **Period membership:** count records inside one aligned L23 cell
   (131,072 seconds), using `[start,end)` numeric/Date bounds or a precompiled
   TIX time-prefix mask. All records are at L42. A mixed-level interval dataset
   would also need to test levels and define containment versus overlap.
2. **Regular-grid preparation:** accumulate each observation's value and count
   into 1,024 aligned L27 cells (8,192 seconds each). Python compares datetime
   deltas, integer millisecond division and TIX prefix masking/shifting.
   JavaScript compares Date.getTime(), numeric division and BigInt prefixes.
   Every method computes the same sums and counts, in the same source order.
   Means can be derived from sum/count where count is nonzero.

For the million-observation fixtures, every implementation finds **15,433**
records in the query, all **1,024** grid cells are occupied, and the aggregate
value sum is **−685,492**. Each run compares every bin's sum and count across its
methods, not just this checksum. Tests also cover exact interval boundaries and
missing bins. No observations are invented for a bin with count zero.

These scans do not require sorting. Repeated queries on a sorted timestamp
array with binary search or a preaggregated index can outperform any full scan;
TIX is an interval encoding, not automatically an index.

## Timing and memory

Prepare and validate inputs before timing. Report encoding/materialization costs
separately. Warm each kernel once, rotate method order across 8,192-record
batches, add batch times into a full pass, and take the median of three passes.
Date batches are created outside the measured kernels and their preparation
cost is reported per pass. TIX loops operate on already validated codes with a
precompiled query mask, rather than revalidating a million codes. All compared
kernels are specialized to these aligned intervals.

For a one-off task, include conversion/setup cost. For already stored codes or
repeated work, preparation may be amortized. General integer time representations
can use the same dyadic arithmetic. This measures implementations in particular
runtimes, not a unique algorithmic capability or a universal speedup.

The source dataset uses 18,000,000 payload bytes for both time representations
and common observation values: 8 bytes each for the numeric timestamp and
64-bit TIX array, plus 2 bytes for each observation value. Small bin accumulators
and at most 8,192 Date/datetime objects per batch are additional. Array headers,
temporary objects, garbage collection and the runtime heap are not included in
this payload count; it is not a peak-memory measurement. The worker is terminated
on completion or cancellation, and never sends the dataset to the main page.

Native packed TIX48 is **six bytes** per code: 6 MB for one million. The actual
uint64/BigUint64Array is **eight bytes**, equal to the tested numeric timestamp
array's width. The packed number is a calculated storage comparison; no packed
six-byte implementation is timed. A custom timestamp representation can also be
packed. For dyadic intervals, one TIX additionally carries the interval level;
an arbitrary interval may need multiple cells.

## Relation to spectral analysis

The grid workload prepares inputs that could be used for time-series analysis.
**No FFT is timed.** An ordinary FFT expects a regularly spaced sequence, and
TIX does not change its transform complexity. Aggregation changes the signal;
choose bin width, aggregation, weighting and missing-bin treatment deliberately.
A coarse observation interval cannot be assigned to finer bins without further
assumptions. Direct uneven-sampling methods, including Lomb–Scargle, are another
option. See [NumPy's DFT documentation](https://numpy.org/doc/stable/reference/routines.fft.html)
and [SciPy's Lomb–Scargle documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.lombscargle.html).
