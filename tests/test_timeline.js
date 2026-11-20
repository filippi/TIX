"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const t = require('../docs/tix.js');
const {layout} = require('../docs/timeline.js');
let cases = 0;
for (const row of fs.readFileSync(path.join(__dirname,'vectors.tsv'),'utf8').split('\n')) {
  if (!row || row[0] === '#') continue;
  const [name,w,q,l,h] = row.split(/\s+/), bits=Number(w), code=t.fromHex(h,bits);
  const m=layout(code,bits), selected=m.rows.find(r=>r.level===Number(l));
  assert(selected,name);assert.equal(selected.cells.filter(c=>c.selected).length,1);
  assert.equal(selected.cells.find(c=>c.selected).x,37.5);
  assert.equal(selected.cells.find(c=>c.selected).width,25);
  assert.equal(m.rows[0].level,Math.max(0,Number(l)-5));
  assert.equal(m.rows.at(-1).level,Math.min(bits-6,Number(l)+5));
  for (let i=0;i<m.rows.length;i++) {
    const r=m.rows[i];
    if(i){assert.equal(r.level,m.rows[i-1].level+1);assert.equal(r.duration*2n,m.rows[i-1].duration);}
    assert(r.cells.length<=129); // bounded work, even near the full numeric domain
    assert(t.contains(r.focus,t.encode(m.anchor,bits-6,bits),bits));
    for(let j=0;j<r.cells.length;j++) {
      const c=r.cells[j];
      assert.deepEqual(t.decode(c.code,bits),{level:r.level,start:c.start,end:c.end});
      assert(c.x>=0 && c.width>0 && c.x+c.width<=100.00001);
      if(j)assert.equal(r.cells[j-1].end,c.start);
      // Every visible child maps to the corresponding visible parent.
      if(i)assert(m.rows[i-1].cells.some(parent=>parent.code===t.parent(c.code,r.level-1,bits)));
    }
  }
  cases++;
}
// Exact alignment: a one-second interval divides into 2 halves and 4 quarters.
const epoch=layout(t.encode(0n,40));
const halves=epoch.rows.find(r=>r.level===41).cells.filter(c=>c.related);
const quarters=epoch.rows.find(r=>r.level===42).cells.filter(c=>c.related);
assert.equal(halves.length,2);assert.equal(quarters.length,4);
assert.equal(halves[0].x,37.5);assert.equal(halves[0].width,12.5);
assert.equal(quarters[0].width,6.25);assert.equal(quarters.at(-1).x+quarters.at(-1).width,62.5);
assert.throws(()=>layout(t.encode(0n,40),48,-1n));
assert.throws(()=>layout(t.encode(0n,40),48,4n));
console.log(`Timeline: ${cases} shared intervals passed geometry, consecutive-level and dyadic alignment checks`);
