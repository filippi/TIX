/* TIX exact interval helpers. Default width: 48. MIT license. */
(function (root) {
  "use strict";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function integer(value) {
    if (typeof value !== "bigint") throw Error("Expected an integer BigInt");
    return value;
  }
  function prefixBits(bits) {
    if (!Number.isInteger(bits) || bits < 7 || bits > 64) throw Error("Width must be between 7 and 64 bits");
    return bits - 6;
  }
  function level(value, bits = 48) {
    if (!Number.isInteger(value) || value < 0 || value > prefixBits(bits)) throw Error(`Level must be between 0 and ${bits - 6}`);
    return value;
  }
  function validate(code, bits = 48) {
    integer(code);
    const p = prefixBits(bits);
    if (code < 0n || code >= (1n << BigInt(bits))) throw Error(`Code must be an unsigned ${bits}-bit integer`);
    const l = level(Number(code >> BigInt(p)), bits);
    if (code & ((1n << BigInt(p - l)) - 1n)) throw Error("Noncanonical code: nonzero padding");
    return code;
  }
  function encode(ticks, l, bits = 48) {
    integer(ticks); level(l, bits);
    const p = prefixBits(bits), epoch = 1n << BigInt(p - 1);
    if (ticks < -epoch || ticks >= epoch) throw Error("Time outside the TIX domain");
    const shift = BigInt(p - l);
    return (BigInt(l) << BigInt(p)) | (((ticks + epoch) >> shift) << shift);
  }
  function decode(code, bits = 48) {
    validate(code, bits);
    const p = prefixBits(bits), mask = (1n << BigInt(p)) - 1n;
    const l = Number(code >> BigInt(p)), start = (code & mask) - (1n << BigInt(p - 1));
    return {level: l, start, end: start + (1n << BigInt(p - l))};
  }
  function parent(code, l, bits = 48) {
    validate(code, bits); level(l, bits);
    const p = prefixBits(bits), mask = (1n << BigInt(p)) - 1n;
    if (l > Number(code >> BigInt(p))) throw Error("Parent level must be no finer than current level");
    const shift = BigInt(p - l);
    return (BigInt(l) << BigInt(p)) | (((code & mask) >> shift) << shift);
  }
  function children(code, bits = 48) {
    const {level: l} = decode(code, bits), p = prefixBits(bits);
    if (l === p) throw Error(`Level ${p} has no children`);
    const first = (BigInt(l + 1) << BigInt(p)) | (code & ((1n << BigInt(p)) - 1n));
    return [first, first | (1n << BigInt(p - 1 - l))];
  }
  function contains(outer, inner, bits = 48) {
    validate(outer, bits); validate(inner, bits);
    const p = BigInt(prefixBits(bits));
    return (outer >> p) <= (inner >> p) && parent(inner, Number(outer >> p), bits) === outer;
  }
  function overlaps(a, b, bits = 48) { return contains(a, b, bits) || contains(b, a, bits); }
  function cover(startQ, endQ, finest, bits = 48) {
    integer(startQ); integer(endQ);
    const p = prefixBits(bits), epoch = 1n << BigInt(p - 1);
    finest = finest === undefined ? p : level(finest, bits);
    if (startQ < -epoch || endQ > epoch || startQ > endQ) throw Error("Range must be ordered and inside the TIX domain");
    if (startQ === endQ) return [];
    const unit = 1n << BigInt(p - finest);
    let start = (startQ + epoch) / unit * unit;
    const end = (endQ + epoch + unit - 1n) / unit * unit, result = [];
    while (start < end) {
      let size = 1n, power = 0;
      while ((size << 1n) <= end - start && !(start & ((size << 1n) - 1n))) { size <<= 1n; power++; }
      result.push((BigInt(p - power) << BigInt(p)) | start);
      start += size;
    }
    return result;
  }
  function toHex(code, bits = 48) { return validate(code, bits).toString(16).padStart(Math.ceil(bits / 4), "0"); }
  function fromHex(text, bits = 48) {
    prefixBits(bits);
    if (typeof text !== "string" || !new RegExp(`^[0-9a-f]{${Math.ceil(bits / 4)}}$`).test(text)) throw Error(`Expected exactly ${Math.ceil(bits / 4)} lowercase hex digits`);
    return validate(BigInt("0x" + text), bits);
  }
  function toBase64(code, bits = 48) {
    validate(code, bits);
    let text = "";
    for (let i = 0; i < 10; i++) text += alphabet[Number((code >> BigInt(58 - 6 * i)) & 63n)];
    return text + alphabet[Number((code & 15n) << 2n)];
  }
  function fromBase64(text, bits = 48) {
    if (typeof text !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(text)) throw Error("Expected 11 unpadded Base64url characters");
    let code = 0n;
    for (let i = 0; i < 10; i++) code = (code << 6n) | BigInt(alphabet.indexOf(text[i]));
    code = (code << 4n) | BigInt(alphabet.indexOf(text[10]) >> 2);
    validate(code, bits);
    if (toBase64(code, bits) !== text) throw Error("Noncanonical Base64url: unused bits must be zero");
    return code;
  }
  function floorDiv(a, b) { return a >= 0n ? a / b : -((-a + b - 1n) / b); }
  function fromUnixMilliseconds(ms, l, bits = 48) {
    integer(ms);
    return encode(floorDiv(ms * (1n << BigInt(prefixBits(bits))), 1000n * (1n << 40n)), l, bits);
  }
  function formatUTC(ticks, bits = 48) {
    integer(ticks);
    const p = prefixBits(bits), places = Math.max(0, p - 40);
    const unit = 1n << BigInt(places);
    const seconds = p < 40 ? ticks * (1n << BigInt(40 - p)) : floorDiv(ticks, unit);
    const fraction = p < 40 ? 0n : ticks - seconds * unit;
    const suffix = places ? (fraction * 5n ** BigInt(places)).toString().padStart(places, "0").replace(/0+$/, "") : "";
    return new Date(Number(seconds * 1000n)).toISOString().replace(/\.000Z$/, (suffix ? "." + suffix : "") + "Z");
  }
  const api = {prefixBits, validate, encode, decode, parent, children, contains, overlaps,
    cover, toHex, fromHex, toBase64, fromBase64, formatUTC, fromUnixMilliseconds};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TIX = api;
})(globalThis);
