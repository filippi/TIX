/*
 * MIT License
 *
 * Copyright (c) 2026 Jean-Baptiste Filippi
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
/* TIX, MIT license. Copy this header; no separate compilation or allocation.
 * Core timestamps are signed integer ticks (2**(46-TIX_BITS) seconds). Every function
 * returns 1 on success, 0 on error. Outputs are unchanged on error, except cover
 * sets *count to the required capacity when the buffer is too small.
 */
#ifndef TIX_H
#define TIX_H
#include <stdint.h>
#include <stddef.h>
#include <string.h>

#ifndef TIX_BITS
#define TIX_BITS 48
#endif
#if TIX_BITS < 7 || TIX_BITS > 64
#error "TIX_BITS must be between 7 and 64"
#endif
#define TIX_PREFIX_BITS (TIX_BITS - 6)
#define TIX_EPOCH_TICKS (INT64_C(1) << (TIX_PREFIX_BITS - 1))
#define TIX_PREFIX_MASK ((UINT64_C(1) << TIX_PREFIX_BITS) - 1)
#define TIX_COVER_CAPACITY (2 * TIX_PREFIX_BITS)
#define TIX_HEX_DIGITS ((TIX_BITS + 3) / 4)

typedef struct {
    unsigned level;
    int64_t start_ticks;
    int64_t end_ticks; /* excluded */
} tix_interval;

static inline int tix_valid(uint64_t code) {
    unsigned level = (unsigned)(code >> TIX_PREFIX_BITS);
    return
#if TIX_BITS < 64
           code < (UINT64_C(1) << TIX_BITS) &&
#endif
           level <= TIX_PREFIX_BITS &&
           !(code & ((UINT64_C(1) << (TIX_PREFIX_BITS - level)) - 1));
}

static inline int tix_encode(int64_t ticks, unsigned level, uint64_t *out) {
    unsigned shift;
    if (!out || level > TIX_PREFIX_BITS || ticks < -TIX_EPOCH_TICKS ||
        ticks >= TIX_EPOCH_TICKS) return 0;
    shift = TIX_PREFIX_BITS - level;
    *out = ((uint64_t)level << TIX_PREFIX_BITS) |
           (((uint64_t)(ticks + TIX_EPOCH_TICKS) >> shift) << shift);
    return 1;
}

static inline int tix_decode(uint64_t code, tix_interval *out) {
    tix_interval value;
    if (!out || !tix_valid(code)) return 0;
    value.level = (unsigned)(code >> TIX_PREFIX_BITS);
    value.start_ticks = (int64_t)(code & TIX_PREFIX_MASK) - TIX_EPOCH_TICKS;
    value.end_ticks = value.start_ticks + (INT64_C(1) << (TIX_PREFIX_BITS - value.level));
    *out = value;
    return 1;
}

static inline int tix_parent(uint64_t code, unsigned level, uint64_t *out) {
    unsigned shift;
    if (!out || !tix_valid(code) || level > (code >> TIX_PREFIX_BITS)) return 0;
    shift = TIX_PREFIX_BITS - level;
    *out = ((uint64_t)level << TIX_PREFIX_BITS) | (((code & TIX_PREFIX_MASK) >> shift) << shift);
    return 1;
}

static inline int tix_children(uint64_t code, uint64_t out[2]) {
    unsigned level;
    uint64_t first;
    if (!out || !tix_valid(code) || (code >> TIX_PREFIX_BITS) == TIX_PREFIX_BITS) return 0;
    level = (unsigned)(code >> TIX_PREFIX_BITS);
    first = ((uint64_t)(level + 1) << TIX_PREFIX_BITS) | (code & TIX_PREFIX_MASK);
    out[0] = first;
    out[1] = first | (UINT64_C(1) << (TIX_PREFIX_BITS - 1 - level));
    return 1;
}

static inline int tix_contains(uint64_t outer, uint64_t inner, int *out) {
    uint64_t ancestor;
    if (!out || !tix_valid(outer) || !tix_valid(inner)) return 0;
    *out = (outer >> TIX_PREFIX_BITS) <= (inner >> TIX_PREFIX_BITS) &&
           tix_parent(inner, (unsigned)(outer >> TIX_PREFIX_BITS), &ancestor) && ancestor == outer;
    return 1;
}

static inline int tix_overlaps(uint64_t a, uint64_t b, int *out) {
    int ab, ba;
    if (!out || !tix_contains(a, b, &ab) || !tix_contains(b, a, &ba)) return 0;
    *out = ab || ba;
    return 1;
}

/* Minimal ordered cover, rounded outward to finest-level boundaries. Exact at
 * level TIX_PREFIX_BITS. Empty ranges succeed with count=0. At most 2*TIX_PREFIX_BITS cells are required.
 * Query capacity with out=NULL, capacity=0 (returns 0 for nonempty covers).
 */
static inline int tix_cover(int64_t start_q, int64_t end_q, unsigned finest,
                           uint64_t *out, size_t capacity, size_t *count) {
    uint64_t start, end, unit, size, remaining;
    uint64_t cells[TIX_COVER_CAPACITY];
    size_t n = 0;
    unsigned power;
    if (!count || finest > TIX_PREFIX_BITS || start_q < -TIX_EPOCH_TICKS ||
        end_q > TIX_EPOCH_TICKS || start_q > end_q) return 0;
    if (start_q == end_q) { *count = 0; return 1; }
    unit = UINT64_C(1) << (TIX_PREFIX_BITS - finest);
    start = (uint64_t)(start_q + TIX_EPOCH_TICKS) / unit * unit;
    end = ((uint64_t)(end_q + TIX_EPOCH_TICKS) + unit - 1) / unit * unit;
    while (start < end) {
        remaining = end - start;
        size = 1;
        power = 0;
        while ((size << 1) <= remaining && !(start & ((size << 1) - 1))) {
            size <<= 1;
            ++power;
        }
        cells[n++] = ((uint64_t)(TIX_PREFIX_BITS - power) << TIX_PREFIX_BITS) | start;
        start += size;
    }
    if (capacity < n || !out) { *count = n; return 0; }
    memcpy(out, cells, n * sizeof(*out));
    *count = n;
    return 1;
}

static inline int tix_to_hex(uint64_t code, char out[TIX_HEX_DIGITS + 1]) {
    static const char digits[] = "0123456789abcdef";
    unsigned i;
    if (!out || !tix_valid(code)) return 0;
    for (i = 0; i < TIX_HEX_DIGITS; ++i) out[i] = digits[(code >> ((TIX_HEX_DIGITS - 1 - i) * 4)) & 15];
    out[TIX_HEX_DIGITS] = '\0';
    return 1;
}

static inline int tix_from_hex(const char *text, uint64_t *out) {
    uint64_t code = 0;
    size_t i;
    if (!out || !text || strlen(text) != TIX_HEX_DIGITS) return 0;
    for (i = 0; i < TIX_HEX_DIGITS; ++i) {
        unsigned char c = (unsigned char)text[i];
        unsigned digit;
        if (c >= '0' && c <= '9') digit = c - '0';
        else if (c >= 'a' && c <= 'f') digit = c - 'a' + 10;
        else return 0;
        code = (code << 4) | digit;
    }
    if (!tix_valid(code)) return 0;
    *out = code;
    return 1;
}

static inline int tix_to_base64(uint64_t code, char out[12]) {
    static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    unsigned i;
    if (!out || !tix_valid(code)) return 0;
    for (i = 0; i < 10; ++i) out[i] = alphabet[(code >> (58 - i * 6)) & 63];
    out[10] = alphabet[(code & 15) << 2];
    out[11] = '\0';
    return 1;
}

static inline int tix_from_base64(const char *text, uint64_t *out) {
    static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    uint64_t code = 0;
    size_t i;
    if (!out || !text || strlen(text) != 11) return 0;
    for (i = 0; i < 11; ++i) {
        const char *p = strchr(alphabet, text[i]);
        unsigned digit;
        if (!p) return 0;
        digit = (unsigned)(p - alphabet);
        if (i == 10) {
            if (digit & 3) return 0;
            code = (code << 4) | (digit >> 2);
        } else code = (code << 6) | digit;
    }
    if (!tix_valid(code)) return 0;
    *out = code;
    return 1;
}
#endif /* TIX_H */
