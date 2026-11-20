# TIX specification

TIX is a family of dyadic hierarchical interval encodings. **TIX48 is the default
format.** A code identifies an interval, not an instant. All intervals are
half-open: `[start, end)`. Time is POSIX/Unix time with no separate leap-second
representation. This specification does not claim novelty or scientific validation.

## TIX48 layout

A TIX48 is an unsigned integer with **48 meaningful bits**. In an eight-byte
integer field the upper 16 bits must be zero; meaningful width and storage width
are distinct.

```text
47          42 41                          0
+-------------+----------------------------+
| level: 6bit | left-aligned prefix: 42bit  |
+-------------+----------------------------+
               L prefix bits | 42-L zeros
```

Set:

```text
E = 2**39                       = 549755813888 seconds
M = 2**42 - 1                   = 4398046511103
L = code >> 42
s = code & M
```

The code is valid exactly when:

- `0 <= code < 2**48`;
- `0 <= L <= 42`;
- `s & (2**(42-L) - 1) == 0` (canonical zero padding).

Negative codes, upper bits, levels 43–63 and nonzero padding are errors, including
when supplied through text. Do not clear padding or clamp invalid input silently.
The prefix's cell index is `s >> (42-L)` in `[0, 2**L)`.

```text
start_seconds = s / 4 - E
 duration_seconds = 2**(40-L)
end_seconds = start_seconds + duration_seconds
```

Prefer these exact integer operations internally:

```text
start_quarters = s - 2**41
 duration_quarters = 2**(42-L)
end_quarters = start_quarters + duration_quarters
```

The supported domain is **`[-2**39, +2**39)` Unix seconds**, a span of exactly
`2**40 = 1099511627776` seconds (about 34,800 years). Level 0 has exactly one
canonical code, zero, and covers the entire domain. The lower boundary is
included; the upper boundary is excluded as an encodable timestamp, but can be
an interval endpoint. Encoding outside the domain must fail. No clamping.

| Level | Interval duration |
| ---: | ---: |
| 0 | 1,099,511,627,776 seconds |
| 23 | 131,072 seconds |
| 32 | 256 seconds |
| **40** | **exactly 1 second** |
| 41 | 0.5 seconds |
| 42 | 0.25 seconds |

The duration is a resolution, not a claim about observation accuracy. Nothing in
the code can establish how accurately an observation was timed.

## Encoding and hierarchy

For an integer quarter-second timestamp `q` in `[-2**41, 2**41)`:

```text
shift = 42-L
s = ((q + 2**41) >> shift) << shift
code = (L << 42) | s
```

This picks the cell containing the timestamp. A timestamp on a shared boundary
belongs to the cell beginning at that boundary. A convenience encoder accepting
seconds floors to native ticks, including for negative values, after checking the
original value's domain. Exact rational inputs avoid floating-point input loss.

For a canonical code at level `L`, a parent at `K`, where `0 <= K <= L`, is:

```text
parent = (K << 42) | ((s >> (42-K)) << (42-K))
```

`K=L` returns the original code. For `L<42`, its children are:

```text
left  = ((L+1) << 42) | s
right = left | (1 << (41-L))
```

Level 42 has no children. Parent requests finer than the current level fail.
Two children partition their parent exactly and do not overlap.

`A` contains `B` if `A.level <= B.level` and `parent(B, A.level) == A`.
Containment includes equality. Dyadic intervals are either nested or disjoint,
so overlap is exactly `contains(A,B) or contains(B,A)`. Merely touching endpoints
do not overlap. Validate both codes before testing either relationship.

Mask the fine **prefix bits**, then set the new header when generating a grouping
key. Masking bits works within bytes as well as across bytes. A coarser key can
support MapReduce grouping, filtering and temporal buckets for clustering;
actual performance depends on the implementation and workload. Prefix equality
is temporal grouping, not by itself a clustering algorithm.

Codes sort numerically by level first, then by position; sorting mixed levels
numerically does not provide chronological ordering. Decode start boundaries
when chronological ordering across levels is needed.

## Range covering

`cover(start_ticks, end_ticks, finest)` accepts ordered integer native-tick
endpoints inside the closed endpoint domain `[-2**41, 2**41]`. An empty range
returns an empty cover, including at the upper boundary. Reversed, invalid-level
or out-of-domain ranges fail.

For nonempty ranges, translate endpoints by `2**41`. With
`unit = 2**(42-finest)`, round start downward and end upward to multiples of unit.
Starting at the rounded start, repeatedly emit the largest aligned power-of-two
cell fitting the remaining range. Return cells ordered by start.

This cover is minimal in cell count for the rounded range. Its intervals are
nonoverlapping and adjacent, and no two siblings remain unmerged. At finest=42
it is exact for all accepted endpoints. At a coarser finest level it is exact
only for aligned endpoints and otherwise conservatively includes additional
time. The algorithm visits cells, not seconds or ticks. At most 84 cells are
needed for TIX48. Covering an interval is distinct from grouping a point into one
parent; arbitrary ranges may need multiple cells.

## Canonical text

**Hexadecimal:** exactly 12 lowercase digits for TIX48. No `0x`, whitespace,
uppercase, omitted leading zeros or separators. Decode the integer and validate
its level, upper bits and padding.

**Standalone Base64url:** encode the zero-extended code as **eight big-endian
bytes**, use the URL-safe alphabet `A-Z a-z 0-9 - _`, then omit the single trailing
`=`. The result is exactly 11 characters. Reject `=`, whitespace, the ordinary
Base64 `+`/`/` alphabet, nonzero bits above bit 47, invalid codes and nonzero
unused bits in the final character. That final character's six-bit value must
be a multiple of four. Re-encoding must reproduce the input byte-for-byte.

```text
Hex:       8201a262a000
Base64url: AACCAaJioAA
Integer:   142943530950656
Level:     32
Start UTC: 2025-08-10T14:09:04Z
End UTC:   2025-08-10T14:13:20Z
Duration:  256 seconds
```

This encodes a TIX interval alone. It is not THERRA's packed H7/time event
identifier; no THERRA or H3 functionality is required.

## Width convention: TIX32, TIX48, TIX58

For a meaningful width `W`, retain a six-bit level header and let `P=W-6` be the
prefix width. The reference helpers support `7 <= W <= 64`. Supported levels are
`0..P`; the header accommodates these because `P <= 58`.

```text
L = code >> P
s = code & (2**P - 1)
canonical padding = P-L low zero bits
start_seconds = s * 2**(40-P) - 2**39
 duration_seconds = 2**(40-L)
one native tick = 2**(40-P) = 2**(46-W) seconds
start_ticks = s - 2**(P-1)
 duration_ticks = 2**(P-L)
```

Everything above generalizes by replacing prefix width 42 by P and quarter-second
units by native ticks. The domain and level durations remain unchanged. Reject
`code >= 2**W`. Native hex has `ceil(W/4)` lowercase digits; bits in a partial
leading hex digit above W must be zero. Base64url still encodes eight big-endian
bytes into 11 characters, with all bits above W zero. Maximum cover capacity is
`2*P` cells.

| Format | P / maximum level | Finest duration | Native hex digits |
| --- | ---: | ---: | ---: |
| TIX32 | 26 | 16,384 seconds | 8 |
| TIX48 (default) | 42 | 0.25 seconds | 12 |
| TIX58 | 52 | 0.000244140625 seconds | 15 |

Level 40 is exactly one second in any width that represents it (`W >= 46`).
TIX32 has no level 40 and cannot represent one-second cells.

Width is **external metadata**, not encoded in the six-bit level header. Decoders
must know W. To convert a code from prefix width P to Q while preserving its
interval, require `L <= Q`, shift `s` left by `Q-P` if Q is larger (or right by
`P-Q` otherwise), and rebuild `(L << Q) | new_s`. The source code's canonical
padding makes right shifts exact when L is supported by the target. Converting
a finer unsupported interval requires explicitly choosing a coarser containing
interval; that is a change of resolution. Raw integers are not interchangeable.

The website offers TIX32/48/58 and defaults to TIX48. C selects one width per
translation unit using `TIX_BITS` (default 48); avoid combining different widths
within one translation unit. Python and JavaScript default to 48 and accept an
explicit bits parameter on each operation. Do not compare codes across widths
without conversion.

## Reference API and errors

Python uses `encode`, `encode_seconds`, `decode`, `parent`, `children`, `contains`,
`overlaps`, `cover`, `to_hex`, `from_hex`, `to_base64`, `from_base64`, `format_utc`
and `validate`. Core times are integer native ticks. Booleans and nonintegers
are rejected by the core. Errors raise `ValueError`. `decode()` returns a pair
of endpoint ticks; the level is `code >> (bits-6)`.

C provides corresponding `tix_*` helpers (text names use the same underscore
spelling). `tix_valid` returns 1 for a valid code and 0 otherwise. Other functions
return explicit 1/0 success/error; containment and overlap put their Boolean
answer in an `int *`. Output pointers must be nonnull; text output buffers must
hold `TIX_HEX_DIGITS+1` or 12 characters, respectively. Input strings must be
NUL-terminated. Fixed-size array arguments document caller buffer requirements.
No function allocates memory. Outputs stay unchanged on errors except that
`tix_cover` reports the required count when its capacity is insufficient.
A NULL cover buffer with zero capacity queries the count; a nonempty query
returns 0 with the required count, while an empty query returns 1 and count 0.
There is no floating-point or UTC formatting dependency in C.

JavaScript uses `BigInt` for timestamps, codes, shifts and masks. Levels and
widths are small integer Numbers. `decode()` returns `{level, start, end}` in
native ticks. Errors throw. Browser UTC formatting displays exact native tick
fractions and supports the entire TIX domain, including extended ISO years.
The interactive timeline starts live at the current one-second cell (L40 for
TIX48), displaying up to five consecutive levels on either side, clipped at the
format’s level limits. Rows share one time axis. Cell selection or canonical
hex/Base64url input pauses and recenters the view. The Live time control resumes
the current-time view. The moving marker follows the local clock; this does not
change interval resolution or imply observational accuracy.

Python's numeric core covers the complete domain. `format_utc` is a separate
convenience using datetime; dates outside years 1–9999 raise an explanatory
`ValueError` and the numeric code remains valid. UTC formatting must not impose
calendar-library limits on encoding, hierarchy or range operations.

[Shared vectors](tests/vectors.tsv), [invalid encodings](tests/invalid.tsv),
[relationships](tests/operations.tsv) and [range covers](tests/ranges.tsv) are
consumed by all three implementations. Native-tick columns are signed decimal
integers and the width column is explicit.
