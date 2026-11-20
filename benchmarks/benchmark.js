/* Node reference run; the page uses the same kernels in a Web Worker. */
"use strict";
const benchmark = require('../docs/benchmark.js');
const count = process.argv[2] === undefined ? 1000000 : Number(process.argv[2]);
const result = benchmark.run(count, 3);
console.log(JSON.stringify({environment: {node: process.version, platform: process.platform, machine: process.arch}, ...result}, null, 2));
