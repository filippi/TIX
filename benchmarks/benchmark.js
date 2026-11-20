/* Same primitive buffers and kernels as the browser worker, including WASM. */
"use strict";
const fs = require('node:fs'), path = require('node:path');
const benchmark = require('../docs/benchmark.js');
const count = process.argv[2] === undefined ? 2000000 : Number(process.argv[2]);
const backend = benchmark.createWasmBackend(fs.readFileSync(path.join(__dirname, '../docs/benchmark.wasm')), count);
const result = benchmark.run(count, 3, () => {}, {backend});
console.log(JSON.stringify({environment: {node: process.version, platform: process.platform, machine: process.arch}, ...result}, null, 2));
