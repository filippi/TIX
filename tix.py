"""TIX: exact half-open intervals. Default TIX48 ticks are quarter-seconds.

Copy this file (or the functions and helpers you need). No installation required.

MIT License

Copyright (c) 2026 Jean-Baptiste Filippi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""

import base64
from datetime import datetime, timedelta, timezone
from fractions import Fraction
import re

EPOCH_QUARTERS = 1 << 41
PREFIX_MASK = (1 << 42) - 1


def _integer(value):
    if type(value) is not int:
        raise ValueError("Expected an integer (booleans are not accepted)")
    return value


def _prefix_bits(bits):
    if not 7 <= _integer(bits) <= 64:
        raise ValueError("Width must be between 7 and 64 bits")
    return bits - 6


def _level(level, bits=48):
    if not 0 <= _integer(level) <= _prefix_bits(bits):
        raise ValueError(f"Level must be between 0 and {bits - 6}")
    return level


def validate(code, bits=48):
    """Return code, rejecting upper bits, invalid levels and nonzero padding."""
    prefix_bits = _prefix_bits(bits)
    if not 0 <= _integer(code) < (1 << bits):
        raise ValueError(f"Code must be an unsigned {bits}-bit integer")
    level = _level(code >> prefix_bits, bits)
    if code & ((1 << (prefix_bits - level)) - 1):
        raise ValueError("Noncanonical code: nonzero padding")
    return code


def encode(time_ticks, level, bits=48):
    """Cell containing integer ticks (one tick = 2**(46-bits) seconds)."""
    _level(level, bits)
    prefix_bits = _prefix_bits(bits)
    epoch = 1 << (prefix_bits - 1)
    if not -epoch <= _integer(time_ticks) < epoch:
        raise ValueError("Time outside [-2**39, 2**39) Unix seconds")
    shift = prefix_bits - level
    prefix = ((time_ticks + epoch) >> shift) << shift
    return (level << prefix_bits) | prefix


def encode_seconds(seconds, level, bits=48):
    """Convenience encoder; floor to native ticks. Fraction preserves exact inputs.

    Float inputs retain only their existing precision. No clamping is performed.
    """
    if isinstance(seconds, bool):
        raise ValueError("Expected finite Unix seconds")
    try:
        ticks = Fraction(seconds) * Fraction(1 << _prefix_bits(bits), 1 << 40)
    except (ValueError, TypeError, OverflowError) as exc:
        raise ValueError("Expected finite Unix seconds") from exc
    epoch = 1 << (_prefix_bits(bits) - 1)
    if not -epoch <= ticks < epoch:
        raise ValueError("Time outside [-2**39, 2**39) Unix seconds")
    return encode(ticks.numerator // ticks.denominator, level, bits)


def decode(code, bits=48):
    """Return (start_ticks, end_ticks), with end excluded; default ticks = 0.25s."""
    validate(code, bits)
    p = _prefix_bits(bits)
    start = (code & ((1 << p) - 1)) - (1 << (p - 1))
    return start, start + (1 << (p - (code >> p)))


def parent(code, level, bits=48):
    """Return ancestor at level; the current level is allowed."""
    validate(code, bits)
    p = _prefix_bits(bits)
    if _level(level, bits) > code >> p:
        raise ValueError("Parent level must be no finer than the current level")
    shift = p - level
    return (level << p) | (((code & ((1 << p) - 1)) >> shift) << shift)


def children(code, bits=48):
    """Return the two immediate children; leaves have no children."""
    validate(code, bits)
    p = _prefix_bits(bits)
    level = code >> p
    if level == p:
        raise ValueError(f"Level {p} has no children")
    first = ((level + 1) << p) | (code & ((1 << p) - 1))
    return first, first | (1 << (p - 1 - level))


def contains(outer, inner, bits=48):
    validate(outer, bits)
    validate(inner, bits)
    p = _prefix_bits(bits)
    return (outer >> p) <= (inner >> p) and parent(inner, outer >> p, bits) == outer


def overlaps(a, b, bits=48):
    """Dyadic cells overlap exactly when one contains the other."""
    return contains(a, b, bits) or contains(b, a, bits)


def cover(start_ticks, end_ticks, finest=None, bits=48):
    """Minimal ordered cover, rounded outward to finest-level boundaries.

    Exact for aligned endpoints (always exact at the maximum level). Empty ranges return
    []. Both endpoints may equal the domain end only for an empty range.
    """
    p = _prefix_bits(bits)
    finest = p if finest is None else _level(finest, bits)
    epoch = 1 << (p - 1)
    _integer(start_ticks)
    _integer(end_ticks)
    if not -epoch <= start_ticks <= end_ticks <= epoch:
        raise ValueError("Range must be ordered and inside the TIX domain")
    if start_ticks == end_ticks:
        return []
    unit = 1 << (p - finest)
    start = (start_ticks + epoch) // unit * unit
    end = ((end_ticks + epoch + unit - 1) // unit) * unit
    result = []
    while start < end:
        remaining = 1 << ((end - start).bit_length() - 1)
        size = min(start & -start, remaining) if start else remaining
        level = p - (size.bit_length() - 1)
        result.append((level << p) | start)
        start += size
    return result


def to_hex(code, bits=48):
    return f"{validate(code, bits):0{(bits + 3) // 4}x}"


def from_hex(text, bits=48):
    """Fixed-width lowercase hex (12 digits by default), no whitespace or 0x."""
    _prefix_bits(bits)
    digits = (bits + 3) // 4
    if not isinstance(text, str) or not re.fullmatch(r"[0-9a-f]{" + str(digits) + "}", text):
        raise ValueError(f"Expected exactly {digits} lowercase hex digits")
    return validate(int(text, 16), bits)


def to_base64(code, bits=48):
    return base64.urlsafe_b64encode(validate(code, bits).to_bytes(8, "big")).decode()[:-1]


def from_base64(text, bits=48):
    if not isinstance(text, str) or not re.fullmatch(r"[A-Za-z0-9_-]{11}", text):
        raise ValueError("Expected 11 unpadded Base64url characters")
    code = int.from_bytes(base64.urlsafe_b64decode(text + "="), "big")
    validate(code, bits)
    if to_base64(code, bits) != text:
        raise ValueError("Noncanonical Base64url: unused bits must be zero")
    return code


def format_utc(time_ticks, bits=48):
    """Exact UTC text; datetime year limits do not limit numeric operations."""
    _integer(time_ticks)
    p = _prefix_bits(bits)
    if p >= 40:
        places = p - 40
        seconds, fraction = divmod(time_ticks, 1 << places)
        suffix = (f"{fraction * 5**places:0{places}d}".rstrip("0")
                  if places else "")
    else:
        seconds, suffix = time_ticks * (1 << (40 - p)), ""
    try:
        date = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=seconds)
    except OverflowError as exc:
        raise ValueError("UTC formatting requires Python datetime years 1..9999; "
                         "the numeric TIX interval remains valid") from exc
    return date.isoformat().replace("+00:00", ("." + suffix if suffix else "") + "Z")
