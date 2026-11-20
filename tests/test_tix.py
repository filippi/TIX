"""Run from the repository root: python3 -m unittest discover -s tests -v"""
import json
from pathlib import Path
import random
import unittest
from fractions import Fraction
import tix

HERE = Path(__file__).parent

def rows(name):
    return [line.split() for line in (HERE / name).read_text().splitlines()
            if line and not line.startswith('#')]

class TixTests(unittest.TestCase):
    def test_shared_vectors(self):
        for name, w, q, l, h, b, a, z in rows('vectors.tsv'):
            w,q,l,a,z = map(int,(w,q,l,a,z))
            with self.subTest(name=name,bits=w):
                c=tix.encode(q,l,w)
                self.assertEqual(tix.to_hex(c,w),h)
                self.assertEqual(tix.to_base64(c,w),b)
                self.assertEqual(tix.from_hex(h,w),c)
                self.assertEqual(tix.from_base64(b,w),c)
                self.assertEqual(tix.decode(c,w),(a,z))
                self.assertEqual(tix.parent(c,l,w),c)
                if l:
                    par=tix.parent(c,l-1,w)
                    self.assertIn(c,tix.children(par,w))
                if l<w-6:
                    left,right=tix.children(c,w)
                    self.assertEqual(tix.parent(left,l,w),c)
                    self.assertEqual(tix.parent(right,l,w),c)
                    self.assertTrue(tix.contains(c,left,w))
                    self.assertFalse(tix.overlaps(left,right,w))
                    self.assertEqual(tix.decode(left,w)[1],tix.decode(right,w)[0])
                else:
                    with self.assertRaises(ValueError):tix.children(c,w)
                with self.assertRaises(ValueError):tix.parent(c,l+1,w)

    def test_shared_invalid(self):
        for w,kind,value in rows('invalid.tsv'):
            w=int(w)
            with self.subTest(bits=w,kind=kind,value=value), self.assertRaises(ValueError):
                if kind=='hex':tix.from_hex(value,w)
                elif kind=='base64':tix.from_base64(value,w)
                elif kind=='code':tix.validate(int(value),w)
                elif kind=='time':tix.encode(int(value),0,w)
                elif kind=='level':tix.encode(0,int(value),w)

    def test_shared_operations(self):
        for w,kind,a,b,expected in rows('operations.tsv'):
            w=int(w)
            self.assertEqual(getattr(tix,kind)(int(a,16),int(b,16),w),bool(int(expected)))

    def test_shared_ranges(self):
        for w,a,b,l,expected in rows('ranges.tsv'):
            w,a,b,l=map(int,(w,a,b,l))
            result=tix.cover(a,b,l,w)
            self.assertEqual(','.join(tix.to_hex(c,w) for c in result) or '-',expected)

    def test_cover_properties(self):
        rng=random.Random(48)
        for bits in (10,32,48,58,64):
            p=bits-6;e=1<<(p-1)
            for _ in range(200):
                a,b=sorted((rng.randrange(-e,e+1),rng.randrange(-e,e+1)))
                finest=rng.randrange(p+1);unit=1<<(p-finest)
                cells=tix.cover(a,b,finest,bits)
                self.assertLessEqual(len(cells),2*p)
                if a==b:self.assertEqual(cells,[]);continue
                decoded=[tix.decode(c,bits) for c in cells]
                self.assertEqual(decoded[0][0],(a+e)//unit*unit-e)
                self.assertEqual(decoded[-1][1],(b+e+unit-1)//unit*unit-e)
                for i in range(len(cells)-1):
                    self.assertEqual(decoded[i][1],decoded[i+1][0])
                    l=cells[i]>>p
                    if l and l==cells[i+1]>>p:
                        self.assertNotEqual(tix.parent(cells[i],l-1,bits),tix.parent(cells[i+1],l-1,bits))

    def test_seconds_and_formatting(self):
        self.assertEqual(tix.encode_seconds(Fraction(-1,100),42),tix.encode(-1,42))
        self.assertEqual(tix.format_utc(-1),'1969-12-31T23:59:59.75Z')
        self.assertEqual(tix.format_utc(1,58),'1970-01-01T00:00:00.000244140625Z')
        self.assertEqual(tix.format_utc(tix.decode(tix.from_hex('8201a262a000'))[0]),'2025-08-10T14:09:04Z')
        for q in (-tix.EPOCH_QUARTERS,tix.EPOCH_QUARTERS):
            with self.assertRaisesRegex(ValueError,'datetime'):tix.format_utc(q)
        for v in (True,float('nan'),float('inf'),-(1<<39)-1,1<<39):
            with self.assertRaises(ValueError):tix.encode_seconds(v,40)
        for fn,args in [(tix.validate,(True,)),(tix.encode,(0.5,40)),(tix.encode,(0,True)),(tix.cover,(1,0)),(tix.cover,(-tix.EPOCH_QUARTERS-1,0)),(tix.validate,(0,6)),(tix.validate,(0,65))]:
            with self.assertRaises(ValueError):fn(*args)
        # Same interval at a common level, re-encoded for each width.
        for bits in (48,58,64):
            c=tix.encode_seconds(0,40,bits)
            a,b=tix.decode(c,bits)
            self.assertEqual(Fraction(b-a)*Fraction(1<<40,1<<(bits-6)),1)

    def test_website_sources_match(self):
        data=(HERE.parent/'docs'/'sources.js').read_text()
        sources=json.loads(data.removeprefix('window.TIX_SOURCES = ').removesuffix(';\n'))
        for filename in ('tix.py','tix.h'):
            self.assertEqual(sources[filename],(HERE.parent/filename).read_text())

if __name__=='__main__':unittest.main()
