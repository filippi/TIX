"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const b=require('../docs/benchmark.js');
const html=fs.readFileSync(path.join(__dirname,'../docs/index.html'),'utf8');
class Element{
  constructor(){this.children=[];this.style={};this.textContent='';this.hidden=false;this.disabled=false;this.listeners={};}
  append(...children){this.children.push(...children);}
  replaceChildren(){this.children=[];}
  addEventListener(event,callback){this.listeners[event]=callback;}
  setAttribute(){}
  click(){this.listeners.click();}
}
const elements={};
for(const match of html.matchAll(/\bid="([^"]+)"/g))elements[match[1]]=new Element();
assert.match(html,/<option value="2000000" selected>/);
elements['bench-size'].value='100000';
const workers=[];
class WorkerStub{
  constructor(url){assert.equal(url,'benchmark-worker.js');workers.push(this);}
  postMessage(message){this.request=message;}
  terminate(){this.terminated=true;}
  send(message){this.onmessage({data:message});}
}
const context=vm.createContext({Worker:WorkerStub,document:{getElementById:id=>{assert(elements[id],id);return elements[id];},createElement:()=>new Element()}});
context.window=context;
vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/benchmark-ui.js'),'utf8'),context);
const backend=b.createWasmBackend(fs.readFileSync(path.join(__dirname,'../docs/benchmark.wasm')),100000);
const e=elements,result=b.run(100000,3,()=>{},{backend,targetMs:0});
e['bench-run'].click();assert(e['bench-run'].disabled);assert(!e['bench-cancel'].hidden);
assert.equal(workers[0].request.count,100000);
workers[0].send({type:'progress',phase:'measure',repeat:2,repeats:3,completed:50000,total:100000});
assert.match(e['bench-status'].textContent,/pass 2/);assert(e['bench-progress'].value>0.2);
workers[0].send({type:'done',result});assert(workers[0].terminated);assert(!e['bench-run'].disabled);assert(!e['bench-results'].hidden);
assert.match(e['bench-status'].textContent,/100,000 observations/);
assert.equal(e['bench-count-rows'].children.length,6);assert.equal(e['bench-grid-rows'].children.length,6);
assert.equal(e['bench-packed'].textContent,'0.60 MB');assert.equal(e['bench-tix-memory'].textContent,'0.80 MB');
assert.match(e['bench-setup'].textContent,/outside the timed kernels/);
e['bench-run'].click();const cancelled=workers[1];e['bench-cancel'].click();assert(cancelled.terminated);assert(!e['bench-run'].disabled);
cancelled.send({type:'done',result});assert.equal(e['bench-status'].textContent,'Benchmark cancelled.');
e['bench-run'].click();workers[2].send({type:'error',message:'invalid count'});assert.match(e['bench-status'].textContent,/invalid count/);assert(workers[2].terminated);
e['bench-run'].click();workers[3].onerror();assert.match(e['bench-status'].textContent,/smaller dataset/);assert(workers[3].terminated);
delete context.Worker;e['bench-run'].click();assert.match(e['bench-status'].textContent,/cannot run/);assert(!e['bench-run'].disabled);
console.log('Benchmark UI: worker lifecycle, progress, rendering, memory accounting, cancellation and failures passed');
