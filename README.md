# TIX

**A dyadic hierarchical temporal primitive.**

TIX represents a half-open time interval `[start, end)` as one unsigned integer.
A six-bit header gives its level; a left-aligned time prefix gives its position.
Each finer level splits an interval into two equal children.

**[Explore the decoder and copy the Python/C helpers](https://filippi.github.io/TIX/)** ·
[Specification](SPEC.md) · [Agent instructions](SKILL.md)

TIX48 is the default: 48 meaningful bits, with a quarter-second finest interval.
The entire domain is `[-2**39, 2**39)` POSIX seconds, centered on the Unix epoch.
**Level 40 is exactly one second.** Level 41 is half a second; level 42 is a
quarter-second. Resolution describes an interval, not observational accuracy.

A coarser time prefix is a grouping key. Masking finer bits and replacing the
level header provides a parent without parsing dates or enumerating timestamps.
This can make temporal filtering, MapReduce grouping and time bucketing for
clustering much faster; performance depends on the workload and engine. TIX is
not itself a clustering algorithm, and this repository makes no benchmark or
scientific-validation claim.

## Python: one file, no installation

Copy [tix.py](tix.py) into your project, or copy its functions and their helpers.
The website has a Copy button for the complete implementation.

```python
import tix

code = tix.encode_seconds(1754834944, 32)
assert tix.to_hex(code) == "8201a262a000"
assert tix.to_base64(code) == "AACCAaJioAA"
start, end = tix.decode(code)  # integer quarter-seconds by default
print(tix.format_utc(start))  # 2025-08-10T14:09:04Z
print(tix.format_utc(end))    # 2025-08-10T14:13:20Z

coarser = tix.parent(code, 23)
assert tix.contains(coarser, code)
left, right = tix.children(code)
assert not tix.overlaps(left, right)
assert tix.cover(start, end) == [code]
```

`encode()`, `decode()` and `cover()` use **integer ticks**. For TIX48 one tick is
one quarter-second, so `encode(4, 40)` encodes Unix second 1. Use
`encode_seconds()` for seconds; use `fractions.Fraction` for exact fractions.
Float inputs can only preserve their existing precision. Numeric operations
cover the entire domain. `format_utc()` explicitly reports Python datetime's
year 1–9999 limitation without invalidating the code.

## C: one header, nothing to link

Copy [tix.h](tix.h) and include it. Every function is `static inline`, uses standard
C99 types, and returns 1 on success or 0 on error. No allocation or third-party
dependency is required.

```c
#include "tix.h"

int main(void) {
    uint64_t code;
    tix_interval interval;
    if (!tix_encode(INT64_C(1754834944) * 4, 32, &code)) return 1;
    if (!tix_decode(code, &interval)) return 1;
    return interval.end_ticks - interval.start_ticks == 1024 ? 0 : 1;
}
```

```sh
cc -std=c99 -Wall -Wextra -Werror -pedantic -I. example.c -o example
```

Containment and overlap return their answer through an `int *` output, keeping
"false" distinct from "invalid input". `tix_cover()` writes an ordered cover to a
caller-provided array; `TIX_COVER_CAPACITY` is a sufficient capacity. An undersized
buffer is left untouched and the required count is reported.

## Widths and text

The same helpers support TIX32, TIX48 and TIX58 (and widths 7 through 64).
Python and JavaScript take an explicit `bits` argument, defaulting to 48. In C,
define `TIX_BITS` before including the header, or compile with `-DTIX_BITS=58`.
One tick is `2**(46-bits)` seconds. Keep width as external metadata; it cannot be
inferred from the code. Re-encode intervals when converting widths.

| Format | Prefix bits / max level | Finest duration | Native hex digits |
| --- | ---: | ---: | ---: |
| TIX32 | 26 | 16,384 seconds | 8 |
| **TIX48** | **42** | **0.25 seconds** | **12** |
| TIX58 | 52 | 244.140625 microseconds | 15 |

All widths use the same time domain and duration `2**(40-level)` seconds.
Level 40 is one second wherever the width supports it; TIX32 stops at level 26.
A TIX48 in a `uint64_t` field has its upper 16 bits zero. Standalone Base64url
always encodes eight big-endian bytes into 11 unpadded characters. Native hex is
fixed-width lowercase. Malformed input, nonzero padding, invalid levels and
out-of-domain time are rejected. No silent clamping.

Range covering is minimal, ordered and exact at the maximum level. At a coarser
requested finest level, endpoints are **rounded outward**. Empty ranges yield no
cells. See [SPEC.md](SPEC.md) for boundaries, canonical text and API conventions.

## Verify or serve locally

```sh
python3 -m unittest discover -s tests -v
node tests/test_tix.js
node tests/test_ui.js
for bits in 32 48 58 64; do
  cc -std=c99 -Wall -Wextra -Werror -pedantic -DTIX_BITS=$bits -I. tests/test_tix.c -o /tmp/test_tix$bits
  /tmp/test_tix$bits
done
python3 -m http.server 8000 --directory docs
```

The Python, C and browser JavaScript implementations consume the same immutable
TSV vectors in `tests/`. They include domain edges, negative time, canonical and
invalid text, exact boundaries, hierarchy, containment, overlap and range covers.
Python additionally checks 1,000 deterministic range-cover cases.
After changing a helper, run `python3 tests/sync_sources.py` to update the website's
copyable source; a test prevents the website from drifting from the actual code.
The static website needs no framework, build process or backend. GitHub Pages
serves `main` → `/docs`.

Jean-Baptiste Filippi · [CNRS](https://www.cnrs.fr/) · [firecaster.org](https://firecaster.org/)

[MIT license](LICENSE). This reference is standalone and independent of THERRA
and H3; it does not modify ingestion, upload packages or archive data.
