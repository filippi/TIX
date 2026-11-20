/* Event-driven application verification using Node built-ins and a minimal DOM.
 * Does not replace visual browser QA. */
"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
class Element {
  constructor(attrs = '') {
    this.value = attrs.match(/\bvalue="([^"]*)"/)?.[1] || '';
    this.hidden = /\bhidden\b/.test(attrs);this.disabled=false;
    this.textContent='';this.children=[];this.listeners={};this.attributes={};
    this.dataset={};this.style={};this.classList={toggle() {}};
  }
  addEventListener(name,fn){this.listeners[name]=fn;}
  setAttribute(key,value){this.attributes[key]=value;}
  removeAttribute(key){delete this.attributes[key];}
  replaceChildren(){this.children=[];}
  append(...elements){this.children.push(...elements);}
  fire(name){return this.listeners[name]({preventDefault() {}});}
  querySelector(){return null;}
}
async function main() {
  const html=fs.readFileSync(path.join(root,'docs/index.html'),'utf8'),elements={};
  for(const match of html.matchAll(/<[a-z][^>]*\bid="([^"]+)"[^>]*>/g))elements[match[1]]=new Element(match[0]);
  let copied='',now=Date.parse('2025-08-10T14:09:04.250Z'),timer;
  class Clock extends Date {static now(){return now;}}
  const context=vm.createContext({console,Date:Clock,setInterval(fn){timer=fn;},document:{
    getElementById:id=>{assert(elements[id],`missing element ${id}`);return elements[id];},
    createElement:()=>new Element(),
  },navigator:{clipboard:{async writeText(text){copied=text;}}}});
  context.window=context;
  for(const file of ['tix.js','timeline.js','sources.js','app.js'])vm.runInContext(fs.readFileSync(path.join(root,'docs',file),'utf8'),context,{filename:file});
  const e=elements;
  const rows=()=>e['timeline-rows'].children;
  const row=l=>rows().find(x=>x.dataset.level===String(l));
  const cells=l=>row(l).children[1].children;
  const go=text=>{e['code-input'].value=text;e['decode-form'].fire('submit');};
  assert.equal(e.start.textContent,'2025-08-10T14:09:04Z');
  assert.equal(e.end.textContent,'2025-08-10T14:09:05Z');
  assert.equal(e.duration.textContent,'1 second');
  assert.deepEqual(rows().map(x=>Number(x.dataset.level)),[35,36,37,38,39,40,41,42]);
  assert.equal(e['live-button'].attributes['aria-pressed'],'true');
  const cursor=e['time-cursor'].style.left;
  now+=200;timer();assert.notEqual(e['time-cursor'].style.left,cursor);
  now+=1000;timer();assert.equal(e.start.textContent,'2025-08-10T14:09:05Z');
  // Live ticks must not overwrite a code while it is being typed.
  e['code-input'].fire('focus');e['code-input'].value='8201';now+=1000;timer();assert.equal(e['code-input'].value,'8201');
  go('AACCAaJioAA');assert.equal(e.hex.textContent,'8201a262a000');
  assert.equal(e.duration.textContent,'256 seconds');
  assert.equal(e['live-button'].attributes['aria-pressed'],'false');assert(e['time-cursor'].hidden);
  assert.deepEqual(rows().map(x=>Number(x.dataset.level)),[27,28,29,30,31,32,33,34,35,36,37]);
  const frozen=e.hex.textContent;now+=1000;timer();assert.equal(e.hex.textContent,frozen);
  // Selecting a visible child must recenter and show five levels on each side.
  const child=cells(33).find(c=>c.className.includes('related'));
  const childCode=child.dataset.code;child.onclick();assert.equal(e.hex.textContent,childCode);
  assert.equal(e['level-badge'].textContent,'TIX48 · L33');
  assert.equal(cells(33).find(c=>c.attributes['aria-current']==='true').style.left,'37.5%');
  row(32).children[0].onclick();assert.equal(e['level-badge'].textContent,'TIX48 · L32');
  // The plot itself provides keyboard level navigation and temporal neighbors.
  let selected=cells(32).find(c=>c.attributes['aria-current']==='true');
  selected.onkeydown({key:'ArrowDown',preventDefault(){}});assert.equal(e['level-badge'].textContent,'TIX48 · L33');
  selected=cells(33).find(c=>c.attributes['aria-current']==='true');
  const before=e.start.textContent;
  selected.onkeydown({key:'ArrowRight',preventDefault(){}});assert.notEqual(e.start.textContent,before);
  // Invalid input must pause and preserve the last valid visible interval.
  const valid=e.hex.textContent;go('broken');assert(!e.error.hidden);assert.equal(e.hex.textContent,valid);
  assert.equal(e['code-input'].attributes['aria-invalid'],'true');
  go('000000000000');assert.equal(rows()[0].dataset.level,'0');assert.equal(rows().at(-1).dataset.level,'5');
  assert.match(e.start.textContent,/^-015452-/);assert.match(e.end.textContent,/^\+019391-/);
  go('aa0000000000');assert.equal(rows().at(-1).dataset.level,'42');assert.match(e['level-limit'].textContent,/ends at L42/);
  e.width.value='58';e.width.fire('change');assert.equal(e['level-badge'].textContent,'TIX58 · L42');
  e.width.value='32';e.width.fire('change');assert.equal(e['level-badge'].textContent,'TIX32 · L26');
  assert.equal(rows().at(-1).dataset.level,'26');
  e.width.value='48';e.width.fire('change');
  e['live-button'].fire('click');assert.equal(e['level-badge'].textContent,'TIX48 · L40');assert.equal(e['live-button'].attributes['aria-pressed'],'true');
  e['live-button'].fire('click');assert.equal(e['live-button'].attributes['aria-pressed'],'false');
  await e['copy-source'].fire('click');assert.equal(copied,fs.readFileSync(path.join(root,'tix.py'),'utf8'));
  e['c-tab'].fire('click');await e['copy-source'].fire('click');assert.equal(copied,fs.readFileSync(path.join(root,'tix.h'),'utf8'));
  let selectedSource=false;
  context.navigator.clipboard.writeText=async()=>{throw Error('denied');};
  context.document.createRange=()=>({selectNodeContents(){selectedSource=true;}});
  context.getSelection=()=>({removeAllRanges(){},addRange(){}});
  await e['copy-source'].fire('click');assert(selectedSource);assert.match(e['copy-status'].textContent,/selected/);
  console.log('Timeline UI: live clock, input, recentering, levels, boundaries, keyboard, widths and copying passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
