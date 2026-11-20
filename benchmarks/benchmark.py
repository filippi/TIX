"""Reproducible, standard-library-only TIX48 comparisons. Run from any directory.

Preparation is reported separately. Timed kernels operate on prepared inputs,
with TIX validation and query-mask compilation outside the inner loops.
"""
import argparse
from array import array
from datetime import datetime, timedelta, timezone
import gc
import json
import math
from pathlib import Path
import platform
import statistics
import sys
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import tix

SEED = 48
SPAN = 1 << 25  # quarters: about 97 days
BASE = (1735689600 * 4 // SPAN) * SPAN
BIN_LEVEL = 27
SHIFT = 42 - BIN_LEVEL
STEP = 1 << SHIFT
BINS = SPAN // STEP
QUERY_LEVEL = 23
QUERY_START = BASE + SPAN // 2
QUERY_END = QUERY_START + (1 << (42 - QUERY_LEVEL))
QUERY_MASK = tix.PREFIX_MASK ^ ((1 << (42 - QUERY_LEVEL)) - 1)
QUERY_PREFIX = (QUERY_START + tix.EPOCH_QUARTERS) & QUERY_MASK
BASE_PREFIX = (BASE + tix.EPOCH_QUARTERS) >> SHIFT
BATCH = 8192
METHODS = ('datetime', 'unix_ms', 'tix48')


def next_random(state):
    state = (state ^ (state << 13)) & 0xffffffff
    state ^= state >> 17
    return (state ^ (state << 5)) & 0xffffffff


def dataset(count):
    timestamps, codes, values = array('q'), array('Q'), array('h')
    state = SEED
    unix_ms = tix_ms = 0.0
    began = perf_counter()
    # Build in bounded batches so encoding preparation can be timed separately.
    for start in range(0, count, BATCH):
        ticks, observations = [], []
        for _ in range(min(BATCH, count-start)):
            state = next_random(state)
            offset = state & (SPAN-1)
            ticks.append(BASE + offset)
            observations.append(round(1000*math.sin(2*math.pi*offset/(STEP*64))) + (state >> 25)-64)
        clock = perf_counter()
        timestamps.extend(q*250 for q in ticks)
        unix_ms += perf_counter()-clock
        clock = perf_counter()
        codes.extend(tix.encode(q, 42) for q in ticks)
        tix_ms += perf_counter()-clock
        values.extend(observations)
    return timestamps, codes, values, {
        'generation_and_encoding_ms': (perf_counter()-began)*1000,
        'unix_ms_materialization_ms': unix_ms*1000,
        'tix48_validated_encoding_ms': tix_ms*1000,
    }


def count_dates(items, lo, hi):
    return sum(1 for value in items if lo <= value < hi)


def count_tix(items):
    return sum(1 for value in items if value & QUERY_MASK == QUERY_PREFIX)


def grid_dates(items, values, counts, sums, origin):
    for date, value in zip(items, values):
        bucket = int((date-origin).total_seconds()*4)//STEP
        counts[bucket] += 1
        sums[bucket] += value


def grid_unix(items, values, counts, sums):
    for stamp, value in zip(items, values):
        bucket = (stamp-BASE*250)//(STEP*250)
        counts[bucket] += 1
        sums[bucket] += value


def grid_tix(items, values, counts, sums):
    for code, value in zip(items, values):
        bucket = ((code & tix.PREFIX_MASK) >> SHIFT)-BASE_PREFIX
        counts[bucket] += 1
        sums[bucket] += value


def run(count=1000000, repeats=3):
    if not 1 <= count <= 2000000 or not 1 <= repeats <= 7:
        raise ValueError('count must be 1..2000000 and repeats 1..7')
    timestamps, codes, values, setup = dataset(count)
    lo = datetime.fromtimestamp(QUERY_START/4, timezone.utc)
    hi = datetime.fromtimestamp(QUERY_END/4, timezone.utc)
    origin = datetime.fromtimestamp(BASE/4, timezone.utc)
    samples = {task: {method: [] for method in METHODS} for task in ('count', 'grid')}
    date_setup = []
    expected = None
    for repeat in range(repeats):
        totals = {method: 0 for method in METHODS}
        grids = {method: ([0]*BINS, [0]*BINS) for method in METHODS}
        elapsed = {task: {method: 0.0 for method in METHODS} for task in samples}
        date_ms = 0.0
        for start in range(0, count, BATCH):
            end = min(start+BATCH, count)
            ms = memoryview(timestamps)[start:end]
            cc = memoryview(codes)[start:end]
            vv = memoryview(values)[start:end]
            clock = perf_counter()
            dates = [datetime.fromtimestamp(value/1000, timezone.utc) for value in ms]
            date_ms += perf_counter()-clock
            inputs = {'datetime': dates, 'unix_ms': ms, 'tix48': cc}
            order = METHODS[(repeat+start//BATCH)%3:] + METHODS[:(repeat+start//BATCH)%3]
            # Warm each kernel once; preparation and warmup are excluded.
            if repeat == 0 and start == 0:
                count_dates(dates,lo,hi);count_dates(ms,QUERY_START*250,QUERY_END*250);count_tix(cc)
                for method in METHODS:
                    c,s = [0]*BINS,[0]*BINS
                    if method=='datetime':grid_dates(dates,vv,c,s,origin)
                    elif method=='unix_ms':grid_unix(ms,vv,c,s)
                    else:grid_tix(cc,vv,c,s)
            for method in order:
                clock = perf_counter()
                if method=='datetime': answer=count_dates(inputs[method],lo,hi)
                elif method=='unix_ms': answer=count_dates(inputs[method],QUERY_START*250,QUERY_END*250)
                else: answer=count_tix(inputs[method])
                elapsed['count'][method] += perf_counter()-clock
                totals[method] += answer
            for method in reversed(order):
                c,s = grids[method]
                clock = perf_counter()
                if method=='datetime':grid_dates(dates,vv,c,s,origin)
                elif method=='unix_ms':grid_unix(ms,vv,c,s)
                else:grid_tix(cc,vv,c,s)
                elapsed['grid'][method] += perf_counter()-clock
            del dates, inputs
        assert len(set(totals.values()))==1, 'Period counts disagree'
        assert grids['datetime']==grids['unix_ms']==grids['tix48'], 'Grid counts/sums disagree'
        assert sum(grids['tix48'][0])==count
        result = (totals['tix48'],grids['tix48'])
        if expected is None:expected=result
        else:assert result==expected, 'Repeat results changed'
        for task in samples:
            for method in METHODS:samples[task][method].append(elapsed[task][method]*1000)
        date_setup.append(date_ms*1000)
        gc.collect()
    counts,sums = expected[1]
    sample = datetime.fromtimestamp(BASE/4,timezone.utc)
    return {
        'environment': {'python': platform.python_version(), 'platform': platform.system(), 'machine': platform.machine()},
        'parameters': {'count': count,'repeats': repeats,'seed': SEED,'batch': BATCH,'source_level':42,
                       'query_level': QUERY_LEVEL,'bin_level': BIN_LEVEL,'bin_seconds':STEP/4,'bins':BINS,
                       'start_utc':tix.format_utc(BASE),'span_seconds':SPAN/4},
        'preparation': {**setup,'datetime_batch_creation_ms_per_pass':statistics.median(date_setup)},
        'timings_ms': {task:{m:{'median':statistics.median(times),'runs':times} for m,times in methods.items()} for task,methods in samples.items()},
        'correctness': {'matched':expected[0],'observations':sum(counts),'occupied_bins':sum(c>0 for c in counts),
                        'empty_bins':sum(c==0 for c in counts),'value_sum':sum(sums),'all_counts_and_sums_identical':True},
        'memory': {'input_array_payload_bytes': sum(len(a)*a.itemsize for a in (timestamps,codes,values)),
                   'datetime_batch_object_bytes_approx': BATCH*(sys.getsizeof(sample)+8),
                   'datetime_plus_timedelta_object_bytes':sys.getsizeof(sample)+sys.getsizeof(timedelta(seconds=1)),
                   'tix_python_int_object_bytes':sys.getsizeof(tix.encode(0,40)),
                   'start_plus_duration_int64_payload_bytes':16,
                   'native_tix48_bytes_per_record':6,'uint64_tix48_bytes_per_record':8,'unix_int64_bytes_per_record':8,
                   'note':'Array payloads exclude headers. The bounded datetime batch is an estimate; this is not peak RSS.'},
        'methodology':'Prepared, unsorted inputs; no index. Median of full passes, summing bounded-batch kernel times. Identical records and bins. Setup/validation excluded and reported separately. No FFT is timed.'
    }


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--count',type=int,default=1000000)
    parser.add_argument('--repeats',type=int,default=3)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    report=run(args.count,args.repeats)
    text=json.dumps(report,indent=2)+'\n'
    if args.output:args.output.write_text(text)
    print(text)
