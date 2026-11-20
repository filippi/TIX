/* Keep dataset allocation and measurement off the page's main thread. */
"use strict";
importScripts("tix.js", "benchmark.js");
self.onmessage = event => {
  try {
    const result = TIXBenchmark.run(event.data.count, 3, progress => self.postMessage({type: "progress", ...progress}));
    self.postMessage({type: "done", result});
  } catch (error) {
    self.postMessage({type: "error", message: error.message});
  }
};
