import { describe, it, expect } from "vitest";
import { SipHash } from "../src/siphash.js";
import { SIP64_VECTORS } from "./vectors.js";

// The reference test uses key = 00 01 02 ... 0f
// and for vector i, the message is 00 01 02 ... (i-1)
const key = new Uint8Array(16);
for (let i = 0; i < 16; i++) key[i] = i;

describe("SipHash-2-4 reference vectors", () => {
  for (let i = 0; i < SIP64_VECTORS.length; i++) {
    it(`vector ${i} (${i}-byte message)`, () => {
      const msg = new Uint8Array(i);
      for (let j = 0; j < i; j++) msg[j] = j;

      const h = new SipHash(key);
      h.write(msg);
      const result = h.finish();

      expect(Array.from(result)).toEqual(SIP64_VECTORS[i]);
    });
  }
});

describe("SipHash streaming equivalence", () => {
  it("byte-at-a-time matches bulk write", () => {
    const msg = new Uint8Array(32);
    for (let i = 0; i < 32; i++) msg[i] = i;

    const bulk = new SipHash(key);
    bulk.write(msg);
    const bulkResult = bulk.finish();

    const streaming = new SipHash(key);
    for (let i = 0; i < 32; i++) {
      streaming.writeU8(msg[i]);
    }
    const streamResult = streaming.finish();

    expect(Array.from(streamResult)).toEqual(Array.from(bulkResult));
  });

  it("chunked writes match bulk write", () => {
    const msg = new Uint8Array(37);
    for (let i = 0; i < 37; i++) msg[i] = i * 7;

    const bulk = new SipHash(key);
    bulk.write(msg);
    const bulkResult = bulk.finish();

    // write in chunks of 3, 5, 11, 7, 11
    const chunks = [3, 5, 11, 7, 11];
    const chunked = new SipHash(key);
    let offset = 0;
    for (const size of chunks) {
      chunked.write(msg.subarray(offset, offset + size));
      offset += size;
    }
    const chunkedResult = chunked.finish();

    expect(Array.from(chunkedResult)).toEqual(Array.from(bulkResult));
  });
});
