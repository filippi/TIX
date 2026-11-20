#!/bin/sh
# Optional development step; the checked-in wasm needs no build in the browser.
set -eu
compiler=${1:-zig}
cd "$(dirname "$0")/.."
"$compiler" cc -target wasm32-freestanding -std=c99 -O3 -msimd128 -nostdlib \
  -fno-builtin -Wall -Wextra -Werror -Wl,--no-entry -Wl,--export-memory \
  -Wl,--export=__heap_base -Wl,--max-memory=67108864 \
  -Wl,--initial-memory=1048576 -Wl,--strip-all \
  benchmarks/kernels.c -o docs/benchmark.wasm
