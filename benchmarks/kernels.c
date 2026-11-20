/* Benchmark-only unchecked kernels, MIT license.
 * Inputs are prepared/validated first. Output arrays have 1024 cells, zeroed by
 * the shared harness before each call. The Unix and TIX paths both use -O3 SIMD.
 * The reusable TIX library remains header-only (tix.h).
 */
#include <stdint.h>
#define EXPORT(name) __attribute__((export_name(name)))

EXPORT("count_unix")
uint32_t count_unix(const double *restrict times, uint32_t count, double lo, double hi) {
    uint32_t hits = 0;
    for (uint32_t i = 0; i < count; ++i) hits += times[i] >= lo && times[i] < hi;
    return hits;
}

EXPORT("count_tix")
uint32_t count_tix(const uint64_t *restrict codes, uint32_t count, uint64_t mask, uint64_t prefix) {
    uint32_t hits = 0;
    for (uint32_t i = 0; i < count; ++i) hits += (codes[i] & mask) == prefix;
    return hits;
}

EXPORT("grid_unix")
void grid_unix(const double *restrict times, const int16_t *restrict values,
               uint32_t count, uint32_t *restrict counts, double *restrict sums,
               double origin, double width) {
    for (uint32_t i = 0; i < count; ++i) {
        uint32_t bucket = (uint32_t)((times[i] - origin) / width);
        ++counts[bucket];
        sums[bucket] += values[i];
    }
}

EXPORT("grid_tix")
void grid_tix(const uint64_t *restrict codes, const int16_t *restrict values,
              uint32_t count, uint32_t *restrict counts, double *restrict sums,
              uint32_t base_bucket) {
    for (uint32_t i = 0; i < count; ++i) {
        uint32_t bucket = (uint32_t)((codes[i] & UINT64_C(4398046511103)) >> 15) - base_bucket;
        ++counts[bucket];
        sums[bucket] += values[i];
    }
}
