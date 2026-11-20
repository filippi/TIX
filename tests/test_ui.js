/* Event-driven decoder smoke test with a minimal DOM, using only Node built-ins.
 * Verifies application behavior; this does not replace visual browser QA. */
"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
class Element {
  constructor(attrs = '') {
    this.value = attrs.match(/\bvalue="([^"]*)"/)?.[1] || '';
    this.hidden = /\bhidden\b/.test(attrs); this.disabled = false;
    this.textContent = ''; this.children = []; this.listeners = {};
    this.attributes = {}; this.classList = {toggle() {}};
  }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  replaceChildren() { this.children = []; }
  append(element) { this.children.push(element); }
  fire(name) { return this.listeners[name]({preventDefault() {}}); }
}
async function main() {
  const html = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
  const elements = {};
  for (const match of html.matchAll(/<[a-z][^>]*\bid="([^"]+)"[^>]*>/g)) elements[match[1]] = new Element(match[0]);
  const examples = [...html.matchAll(/data-example="([^"]+)"/g)].map(match => {
    const element = new Element(); element.dataset = {example: match[1]}; return element;
  });
  let copied = '';
  const context = vm.createContext({console, document: {
    getElementById: id => {assert(elements[id], `missing element ${id}`); return elements[id];},
    createElement: () => new Element(), querySelectorAll: () => examples,
  }, navigator: {clipboard: {async writeText(text) {copied = text;}}}});
  context.window = context;
  for (const file of ['tix.js', 'sources.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(root, 'docs', file), 'utf8'), context, {filename: file});
  const e = elements;
  assert.equal(e.start.textContent, '2025-08-10T14:09:04Z');
  assert.equal(e.end.textContent, '2025-08-10T14:13:20Z');
  assert.equal(e.duration.textContent, '256 seconds');
  assert.equal(e.base64.textContent, 'AACCAaJioAA');
  e['code-input'].value = 'AACCAaJioAA'; e['decode-form'].fire('submit');
  assert.equal(e.hex.textContent, '8201a262a000');
  e.parent.onclick(); assert.equal(e['level-badge'].textContent, 'TIX48 · L31');
  e['child-0'].onclick(); assert.equal(e['level-badge'].textContent, 'TIX48 · L32');
  e['code-input'].value = 'broken'; e['decode-form'].fire('submit');
  assert(!e.error.hidden && e.result.hidden);
  assert.equal(e['code-input'].attributes['aria-invalid'], 'true');
  const example = name => examples.find(x => x.dataset.example === name).fire('click');
  example('universe'); assert(e.parent.disabled && !e['child-0'].disabled);
  assert.match(e.start.textContent, /^-015452-/); assert.match(e.end.textContent, /^\+019391-/);
  example('negative'); assert(e['child-0'].disabled && e['child-1'].disabled);
  assert.equal(e.start.textContent, '1969-12-31T23:59:59.75Z');
  example('epoch'); assert.equal(e.duration.textContent, '1 second');
  e.width.value = '58'; e.width.fire('change');
  assert.equal(e['level-badge'].textContent, 'TIX58 · L40'); assert.equal(e.duration.textContent, '1 second');
  e.width.value = '32'; e.width.fire('change');
  assert.equal(e['level-badge'].textContent, 'TIX32 · L26'); assert.equal(e.duration.textContent, '16,384 seconds');
  assert(e['child-0'].disabled);
  example('known');
  e['utc-input'].value = '1970-01-01T00:00:01'; e['level-input'].value = '40'; e['encode-form'].fire('submit');
  assert.equal(e.start.textContent, '1970-01-01T00:00:01Z');
  assert.equal(e.end.textContent, '1970-01-01T00:00:02Z');
  await e['copy-source'].fire('click');
  assert.equal(copied, fs.readFileSync(path.join(root, 'tix.py'), 'utf8'));
  e['c-tab'].fire('click'); await e['copy-source'].fire('click');
  assert.equal(copied, fs.readFileSync(path.join(root, 'tix.h'), 'utf8'));
  assert.equal(e['c-tab'].attributes['aria-pressed'], 'true');
  // Denied clipboard access must select usable source and explain how to copy.
  let selected = false;
  context.navigator.clipboard.writeText = async () => {throw Error('denied');};
  context.document.createRange = () => ({selectNodeContents() {selected = true;}});
  context.getSelection = () => ({removeAllRanges() {}, addRange() {}});
  await e['copy-source'].fire('click');
  assert(selected); assert.match(e['copy-status'].textContent, /selected/);
  console.log('Decoder UI: navigation, errors, widths, UTC encoding and copy buttons passed (DOM smoke test)');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
