"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const t = require('../docs/tix.js');
const rows = name => fs.readFileSync(path.join(__dirname,name),'utf8').split('\n').filter(s=>s && !s.startsWith('#')).map(s=>s.split(/\s+/));
let checks=0;
for (const [name,w,q,l,h,b,a,z] of rows('vectors.tsv')) {
  const bits=Number(w),level=Number(l),c=t.encode(BigInt(q),level,bits);
  assert.equal(t.toHex(c,bits),h,name);assert.equal(t.toBase64(c,bits),b,name);
  assert.equal(t.fromHex(h,bits),c);assert.equal(t.fromBase64(b,bits),c);
  assert.deepEqual(t.decode(c,bits),{level,start:BigInt(a),end:BigInt(z)});
  assert.equal(t.parent(c,level,bits),c);
  if(level)assert(t.children(t.parent(c,level-1,bits),bits).includes(c));
  if(level<bits-6){
    const [left,right]=t.children(c,bits);
    assert.equal(t.parent(left,level,bits),c);assert.equal(t.parent(right,level,bits),c);
    assert(t.contains(c,left,bits));assert(!t.overlaps(left,right,bits));
    assert.equal(t.decode(left,bits).end,t.decode(right,bits).start);
  } else assert.throws(()=>t.children(c,bits));
  assert.throws(()=>t.parent(c,level+1,bits));checks++;
}
for(const [w,kind,value] of rows('invalid.tsv')){
  const bits=Number(w);
  assert.throws(()=>{
    if(kind==='hex')t.fromHex(value,bits);
    if(kind==='base64')t.fromBase64(value,bits);
    if(kind==='code')t.validate(BigInt(value),bits);
    if(kind==='time')t.encode(BigInt(value),0,bits);
    if(kind==='level')t.encode(0n,Number(value),bits);
  },`${w} ${kind} ${value}`);checks++;
}
for(const [w,kind,a,b,expected] of rows('operations.tsv')){
  assert.equal(t[kind](BigInt('0x'+a),BigInt('0x'+b),Number(w)),expected==='1');checks++;
}
for(const [w,a,b,l,expected] of rows('ranges.tsv')){
  const bits=Number(w),result=t.cover(BigInt(a),BigInt(b),Number(l),bits);
  assert.equal(result.map(c=>t.toHex(c,bits)).join(',') || '-',expected);checks++;
}
assert.equal(t.formatUTC(-1n),'1969-12-31T23:59:59.75Z');
assert.equal(t.formatUTC(1n,58),'1970-01-01T00:00:00.000244140625Z');
assert.equal(t.formatUTC(t.decode(t.fromHex('8201a262a000')).start),'2025-08-10T14:09:04Z');
assert.equal(t.fromUnixMilliseconds(-1n,42),t.encode(-1n,42));
assert.throws(()=>t.validate(0));assert.throws(()=>t.encode(0n,NaN));
assert.throws(()=>t.cover(1n,0n));assert.throws(()=>t.cover(-(1n<<41n)-1n,0n));
assert.throws(()=>t.validate(0n,65));
console.log(`JavaScript: ${checks} shared vector/operation/range cases passed`);
