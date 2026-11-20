"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const b=require('../docs/benchmark.js'),t=require('../docs/tix.js');
async function main(){
  assert.equal(b.median([4,1,3,2]),2.5);
  const c=b.config,ticks=[c.QUERY_START-1,c.QUERY_START,c.QUERY_START+1,c.QUERY_END-1,c.QUERY_END,
    c.BASE,c.BASE+c.STEP-1,c.BASE+c.STEP,c.BASE+c.SPAN-1];
  const inputs={date:ticks.map(q=>new Date(q*250)),unix_ms:Float64Array.from(ticks,q=>q*250),tix48:BigUint64Array.from(ticks,q=>t.encode(BigInt(q),42))};
  inputs.tix_words=new Uint32Array(inputs.tix48.buffer);
  const values=Int16Array.from(ticks,(_,i)=>i),grids=[];
  for(const method of [...b.methods,b.wordMethod]){
    assert.equal(method.count(inputs[method.id]),3);
    const counts=new Uint32Array(1024),sums=new Float64Array(1024);
    method.grid(inputs[method.id],values,counts,sums);grids.push({counts,sums});
  }
  for(const grid of grids)assert.deepEqual(grid,grids[0]);
  assert.equal(grids[0].counts[0],2);assert.equal(grids[0].counts[1],1);assert.equal(grids[0].counts[10],0);
  const bytes=fs.readFileSync(path.join(__dirname,'../docs/benchmark.wasm'));
  assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(bytes)).length,0);
  const backend=b.createWasmBackend(bytes,ticks.length);
  backend.storage.timestamps.set(inputs.unix_ms);backend.storage.codes.set(inputs.tix48);backend.storage.values.set(values);
  for(const method of backend.methods){
    assert.equal(method.count(),3);
    backend.output.counts.fill(0);backend.output.sums.fill(0);method.grid();
    assert.deepEqual(backend.output,grids[0]);
  }
  // Reject a cell with identical low prefix bits but a different high word.
  backend.storage.codes[0]=t.encode(BigInt(c.QUERY_START)+ (1n<<32n),42);
  assert.equal(backend.methods[1].count(),3);
  assert.equal(b.wordMethod.count(new Uint32Array(backend.storage.codes.buffer,backend.storage.codes.byteOffset,ticks.length*2)),3);
  const sampleBackend=b.createWasmBackend(bytes,1000),sample=b.run(1000,3,()=>{},{backend:sampleBackend,targetMs:0});
  assert(sample.correctness.all_counts_and_sums_identical);assert.equal(sample.correctness.observations,1000);
  assert.equal(sample.memory.input_array_payload_bytes,18000);assert(sample.correctness.empty_bins>0);
  assert.equal(Object.keys(sample.timings_ms.count).length,6);
  assert(sample.execution.shared_input_buffers);assert(sample.memory.wasm_linear_memory_bytes<=sample.memory.wasm_memory_cap_bytes);
  for(const args of [[0,1],[2000001,1],[100,0],[100,8],[NaN,1],[1.5,1]])assert.throws(()=>b.run(...args));
  // Coarse clocks: normalize many operations inside one sufficiently long window.
  let clock=0;
  const coarse=vm.createContext({TIX:t,performance:{now:()=>Math.floor(clock)}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/benchmark.js'),'utf8'),coarse);
  const timed=coarse.TIXBenchmark.measure(()=>{clock+=0.02;return 7;},40);
  assert(timed.window_ms>=40);assert(Math.abs(timed.ms-0.02)<0.001);assert.equal(timed.value,7);
  // Actual asynchronous browser worker path, including WASM and its fallback.
  const docs=path.join(__dirname,'../docs'),messages=[];
  const worker=vm.createContext({performance,fetch:async()=>({ok:true,arrayBuffer:async()=>Uint8Array.from(bytes).buffer}),self:{postMessage:message=>messages.push(message)}});
  worker.importScripts=(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(path.join(docs,file),'utf8'),worker,{filename:file});};
  vm.runInContext(fs.readFileSync(path.join(docs,'benchmark-worker.js'),'utf8'),worker);
  await worker.self.onmessage({data:{count:1000}});
  assert.equal(messages.at(-1).type,'done');assert.equal(messages.at(-1).result.correctness.observations,1000);
  assert.equal(Object.keys(messages.at(-1).result.timings_ms.count).length,6);
  worker.fetch=async()=>{throw Error('unavailable');};
  await worker.self.onmessage({data:{count:1000}});
  assert.equal(messages.at(-1).type,'done');assert.match(messages.at(-1).result.execution.wasm_error,/unavailable/);
  await worker.self.onmessage({data:{count:2000001}});assert.equal(messages.at(-1).type,'error');
  console.log('Benchmark: JS/WASM boundaries, word carry, all bin sums, shared buffers, coarse-clock calibration and worker fallback passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
