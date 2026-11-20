/* All data remains in a disposable worker; WASM and JS share the same buffers. */
"use strict";
importScripts("tix.js", "benchmark.js");
self.onmessage = async event => {
  try {
    let backend, wasmError;
    const count = event.data.count;
    if (!Number.isInteger(count) || count < 1 || count > 2000000) throw Error("Use 1..2,000,000 observations");
    self.postMessage({type: "progress", phase: "compile"});
    try {
      const response = await fetch("benchmark.wasm");
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      backend = TIXBenchmark.createWasmBackend(await response.arrayBuffer(), count);
    } catch (error) {wasmError = error.message;}
    const result = TIXBenchmark.run(count, 3, progress => self.postMessage({type: "progress", ...progress}), {backend});
    if (wasmError) result.execution.wasm_error = wasmError;
    self.postMessage({type: "done", result});
  } catch (error) {self.postMessage({type: "error", message: error.message});}
};
