---
name: use-tix
description: Encode, decode, group, or compare TIX temporal intervals using the standalone Python or header-only C helpers, with TIX48 as the default.
---

Use [tix.py](tix.py) directly, or include [tix.h](tix.h); no package installation
or separately linked C implementation is needed. Read [SPEC.md](SPEC.md) for
wire conventions and width conversion.

- Default to TIX48. Preserve explicit width metadata for other widths. Level 40
  is exactly one second wherever supported; TIX32 cannot represent that level.
- Core timestamps are integer native ticks: quarter-seconds for TIX48. Python
  `encode_seconds()` accepts Unix seconds; use Fraction for exact fractional
  input. Keep datetime formatting separate from numeric validity.
- Validate every incoming code and canonical text. Reject out-of-domain time,
  invalid levels, upper bits, nonzero padding and noncanonical text; never clamp
  or clear invalid bits. TIX48 hex is 12 lowercase digits. Standalone Base64url
  represents eight big-endian bytes in 11 unpadded characters.
- Use parent/children and prefix masks for hierarchy. A parent sets the level
  header as well as masking the prefix. Compare only codes of the same width.
- Intervals are `[start, end)`. Boundary-touching cells do not overlap. For range
  filtering use cover, noting that a coarser finest level rounds outward.
- Resolution is not observational accuracy. Prefix grouping can help MapReduce
  and temporal clustering buckets; do not invent performance measurements or
  scientific validation. Do not treat TIX as an instantaneous timestamp.
- Check C success returns before reading outputs; relationship outputs separate
  false from error. Provision `TIX_COVER_CAPACITY` cells for range covers.
- After helper changes run shared Python/C/JavaScript tests and
  `python3 tests/sync_sources.py`; verify the website's copyable code stays exact.
