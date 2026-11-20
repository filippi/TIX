"""Benchmark correctness only; timings are never asserted."""
from datetime import datetime, timezone
import unittest
from benchmarks import benchmark as b
import tix

class BenchmarkTests(unittest.TestCase):
    def test_exact_query_boundaries_and_bins(self):
        ticks=[b.QUERY_START-1,b.QUERY_START,b.QUERY_START+1,b.QUERY_END-1,b.QUERY_END,
               b.BASE,b.BASE+b.STEP-1,b.BASE+b.STEP,b.BASE+b.SPAN-1]
        dates=[datetime.fromtimestamp(q/4,timezone.utc) for q in ticks]
        codes=[tix.encode(q,42) for q in ticks]
        millis=[q*250 for q in ticks]
        expected=sum(b.QUERY_START<=q<b.QUERY_END for q in ticks)
        self.assertEqual(expected,3)
        self.assertEqual(b.count_tix(codes),expected)
        self.assertEqual(b.count_dates(millis,b.QUERY_START*250,b.QUERY_END*250),expected)
        self.assertEqual(b.count_dates(dates,datetime.fromtimestamp(b.QUERY_START/4,timezone.utc),
                                      datetime.fromtimestamp(b.QUERY_END/4,timezone.utc)),expected)
        query=tix.encode(b.QUERY_START,b.QUERY_LEVEL)
        self.assertEqual(sum(tix.contains(query,c) for c in codes),expected)
        outputs=[]
        for method,items in ((b.grid_dates,dates),(b.grid_unix,millis),(b.grid_tix,codes)):
            counts,sums=[0]*b.BINS,[0]*b.BINS
            args=(items,list(range(len(ticks))),counts,sums)
            if method is b.grid_dates:args+= (datetime.fromtimestamp(b.BASE/4,timezone.utc),)
            method(*args);outputs.append((counts,sums))
        self.assertEqual(outputs[0],outputs[1]);self.assertEqual(outputs[1],outputs[2])
        self.assertEqual(outputs[2][0][0],2)
        self.assertEqual(outputs[2][0][1],1)
        self.assertEqual(outputs[2][0][-1],1)
        self.assertEqual(outputs[2][0][10],0)  # no synthetic observation for a missing bin
        self.assertEqual(sum(outputs[2][0]),len(ticks))

    def test_small_reproducible_run(self):
        result=b.run(1000,1)
        self.assertTrue(result['correctness']['all_counts_and_sums_identical'])
        self.assertEqual(result['correctness']['observations'],1000)
        self.assertEqual(result['memory']['input_array_payload_bytes'],18000)
        self.assertGreater(result['correctness']['empty_bins'],0)
        for args in ((0,1),(2000001,1),(100,0),(100,8)):
            with self.assertRaises(ValueError):b.run(*args)

if __name__=='__main__':unittest.main()
