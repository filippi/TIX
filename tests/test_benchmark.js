"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const b=require('../docs/benchmark.js'),t=require('../docs/tix.js');
assert.equal(b.median([4,1,3,2]),2.5);
const c=b.config,ticks=[c.QUERY_START-1,c.QUERY_START,c.QUERY_START+1,c.QUERY_END-1,c.QUERY_END,
  c.BASE,c.BASE+c.STEP-1,c.BASE+c.STEP,c.BASE+c.SPAN-1];
const inputs={date:ticks.map(q=>new Date(q*250)),unix_ms:Float64Array.from(ticks,q=>q*250),tix48:BigUint64Array.from(ticks,q=>t.encode(BigInt(q),42))};
const values=Int16Array.from(ticks,(_,i)=>i),grids=[];
for(const method of b.methods){
  assert.equal(method.count(inputs[method.id]),3);
  const counts=new Uint32Array(1024),sums=new Float64Array(1024);
  method.grid(inputs[method.id],values,counts,sums);grids.push({counts,sums});
}
assert.deepEqual(grids[0],grids[1]);assert.deepEqual(grids[1],grids[2]);
assert.equal(grids[2].counts[0],2);assert.equal(grids[2].counts[1],1);assert.equal(grids[2].counts[10],0);
const query=t.encode(BigInt(c.QUERY_START),23);
assert.equal([...inputs.tix48].filter(code=>t.contains(query,code)).length,3);
const sample=b.run(1000,3);
assert(sample.correctness.all_counts_and_sums_identical);assert.equal(sample.correctness.observations,1000);
assert.equal(sample.memory.input_array_payload_bytes,18000);assert(sample.correctness.empty_bins>0);
for(const args of [[0,1],[1000001,1],[100,0],[100,8],[NaN,1],[1.5,1]])assert.throws(()=>b.run(...args));
// Exercise the actual browser-worker entry point, not just direct kernel calls.
const docs=path.join(__dirname,'../docs'),messages=[];
const worker=vm.createContext({performance,self:{postMessage:message=>messages.push(message)}});
worker.importScripts=(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(path.join(docs,file),'utf8'),worker,{filename:file});};
vm.runInContext(fs.readFileSync(path.join(docs,'benchmark-worker.js'),'utf8'),worker);
worker.self.onmessage({data:{count:1000}});
assert(messages.some(m=>m.type==='progress'));
assert.equal(messages.at(-1).type,'done');assert.equal(messages.at(-1).result.correctness.observations,1000);
worker.self.onmessage({data:{count:1000001}});assert.equal(messages.at(-1).type,'error');
console.log('Benchmark: exact boundaries, bin sums/counts, missing bins, bounded inputs and worker entry point passed');
