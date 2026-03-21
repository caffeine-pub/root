// SipHash-2-4 streaming implementation
// Ported from the reference C implementation by Jean-Philippe Aumasson & Daniel J. Bernstein
// All 64-bit values represented as hi/lo u32 pairs. No BigInt, no arrays.

// initialization constants split into hi/lo u32
// 0x736f6d6570736575
const c0h = 0x736f6d65,
  c0l = 0x70736575;
// 0x646f72616e646f6d
const c1h = 0x646f7261,
  c1l = 0x6e646f6d;
// 0x6c7967656e657261
const c2h = 0x6c796765,
  c2l = 0x6e657261;
// 0x7465646279746573
const c3h = 0x74656462,
  c3l = 0x79746573;

// add two u64s represented as hi/lo pairs
// returns via out parameters to avoid allocation
let _ah = 0,
  _al = 0;
function add64(ah: number, al: number, bh: number, bl: number): void {
  const lo = (al + bl) >>> 0;
  const carry = ((al & bl) | ((al | bl) & ~lo)) >>> 31;
  _ah = (ah + bh + carry) >>> 0;
  _al = lo;
}

// xor two u64s
function xor64h(ah: number, bh: number): number {
  return (ah ^ bh) >>> 0;
}
function xor64l(al: number, bl: number): number {
  return (al ^ bl) >>> 0;
}

// rotate left on u64 represented as hi/lo
// for the specific rotation amounts used in siphash: 13, 16, 17, 21, 32
let _rh = 0,
  _rl = 0;
function rotl64(h: number, l: number, n: number): void {
  if (n === 32) {
    _rh = l;
    _rl = h;
  } else if (n < 32) {
    _rh = ((h << n) | (l >>> (32 - n))) >>> 0;
    _rl = ((l << n) | (h >>> (32 - n))) >>> 0;
  } else {
    const s = n - 32;
    _rh = ((l << s) | (h >>> (32 - s))) >>> 0;
    _rl = ((h << s) | (l >>> (32 - s))) >>> 0;
  }
}

export class SipHash {
  // state: v0..v3 as hi/lo pairs
  private v0h: number;
  private v0l: number;
  private v1h: number;
  private v1l: number;
  private v2h: number;
  private v2l: number;
  private v3h: number;
  private v3l: number;

  // tail buffer as hi/lo
  private tailh: number = 0;
  private taill: number = 0;
  private ntail: number = 0;
  private length: number = 0;

  constructor(key: Uint8Array = new Uint8Array(16)) {
    // read key as two u64 LE
    const k0l =
      (key[0] | (key[1] << 8) | (key[2] << 16) | (key[3] << 24)) >>> 0;
    const k0h =
      (key[4] | (key[5] << 8) | (key[6] << 16) | (key[7] << 24)) >>> 0;
    const k1l =
      (key[8] | (key[9] << 8) | (key[10] << 16) | (key[11] << 24)) >>> 0;
    const k1h =
      (key[12] | (key[13] << 8) | (key[14] << 16) | (key[15] << 24)) >>> 0;

    this.v0h = xor64h(c0h, k0h);
    this.v0l = xor64l(c0l, k0l);
    this.v1h = xor64h(c1h, k1h);
    this.v1l = xor64l(c1l, k1l);
    this.v2h = xor64h(c2h, k0h);
    this.v2l = xor64l(c2l, k0l);
    this.v3h = xor64h(c3h, k1h);
    this.v3l = xor64l(c3l, k1l);
  }

  private sipRound(): void {
    // v0 += v1
    add64(this.v0h, this.v0l, this.v1h, this.v1l);
    this.v0h = _ah;
    this.v0l = _al;
    // v1 = rotl(v1, 13)
    rotl64(this.v1h, this.v1l, 13);
    this.v1h = _rh;
    this.v1l = _rl;
    // v1 ^= v0
    this.v1h = xor64h(this.v1h, this.v0h);
    this.v1l = xor64l(this.v1l, this.v0l);
    // v0 = rotl(v0, 32)
    rotl64(this.v0h, this.v0l, 32);
    this.v0h = _rh;
    this.v0l = _rl;

    // v2 += v3
    add64(this.v2h, this.v2l, this.v3h, this.v3l);
    this.v2h = _ah;
    this.v2l = _al;
    // v3 = rotl(v3, 16)
    rotl64(this.v3h, this.v3l, 16);
    this.v3h = _rh;
    this.v3l = _rl;
    // v3 ^= v2
    this.v3h = xor64h(this.v3h, this.v2h);
    this.v3l = xor64l(this.v3l, this.v2l);

    // v0 += v3
    add64(this.v0h, this.v0l, this.v3h, this.v3l);
    this.v0h = _ah;
    this.v0l = _al;
    // v3 = rotl(v3, 21)
    rotl64(this.v3h, this.v3l, 21);
    this.v3h = _rh;
    this.v3l = _rl;
    // v3 ^= v0
    this.v3h = xor64h(this.v3h, this.v0h);
    this.v3l = xor64l(this.v3l, this.v0l);

    // v2 += v1
    add64(this.v2h, this.v2l, this.v1h, this.v1l);
    this.v2h = _ah;
    this.v2l = _al;
    // v1 = rotl(v1, 17)
    rotl64(this.v1h, this.v1l, 17);
    this.v1h = _rh;
    this.v1l = _rl;
    // v1 ^= v2
    this.v1h = xor64h(this.v1h, this.v2h);
    this.v1l = xor64l(this.v1l, this.v2l);
    // v2 = rotl(v2, 32)
    rotl64(this.v2h, this.v2l, 32);
    this.v2h = _rh;
    this.v2l = _rl;
  }

  private processBlock(mh: number, ml: number): void {
    this.v3h = xor64h(this.v3h, mh);
    this.v3l = xor64l(this.v3l, ml);
    this.sipRound();
    this.sipRound();
    this.v0h = xor64h(this.v0h, mh);
    this.v0l = xor64l(this.v0l, ml);
  }

  private flushTail(): void {
    this.processBlock(this.tailh, this.taill);
    this.tailh = 0;
    this.taill = 0;
    this.ntail = 0;
  }

  /** Write raw bytes into the hash state. */
  write(data: Uint8Array): this {
    let i = 0;
    const len = data.length;
    this.length += len;

    // fill tail buffer first
    while (i < len && this.ntail < 8) {
      const bytePos = this.ntail;
      if (bytePos < 4) {
        this.taill = (this.taill | (data[i] << (bytePos * 8))) >>> 0;
      } else {
        this.tailh = (this.tailh | (data[i] << ((bytePos - 4) * 8))) >>> 0;
      }
      this.ntail++;
      i++;

      if (this.ntail === 8) {
        this.flushTail();
      }
    }

    // process full 8-byte blocks
    while (i + 8 <= len) {
      const ml =
        (data[i] |
          (data[i + 1] << 8) |
          (data[i + 2] << 16) |
          (data[i + 3] << 24)) >>>
        0;
      const mh =
        (data[i + 4] |
          (data[i + 5] << 8) |
          (data[i + 6] << 16) |
          (data[i + 7] << 24)) >>>
        0;
      this.processBlock(mh, ml);
      i += 8;
    }

    // stash remaining bytes in tail
    while (i < len) {
      const bytePos = this.ntail;
      if (bytePos < 4) {
        this.taill = (this.taill | (data[i] << (bytePos * 8))) >>> 0;
      } else {
        this.tailh = (this.tailh | (data[i] << ((bytePos - 4) * 8))) >>> 0;
      }
      this.ntail++;
      i++;
    }

    return this;
  }

  /** Write a single byte. */
  writeU8(value: number): this {
    this.length++;
    const bytePos = this.ntail;
    if (bytePos < 4) {
      this.taill = (this.taill | ((value & 0xff) << (bytePos * 8))) >>> 0;
    } else {
      this.tailh = (this.tailh | ((value & 0xff) << ((bytePos - 4) * 8))) >>> 0;
    }
    this.ntail++;

    if (this.ntail === 8) {
      this.flushTail();
    }

    return this;
  }

  /** Write a uint32 (little-endian). */
  writeU32(value: number): this {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, value, true);
    return this.write(buf);
  }

  /** Write a float64 (little-endian). */
  writeF64(value: number): this {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setFloat64(0, value, true);
    return this.write(buf);
  }

  /** Finalize and return the 8-byte hash as a Uint8Array. */
  finish(): Uint8Array {
    // finalization: encode length in last byte of final block
    const bh = ((this.length & 0xff) << 24) | this.tailh;
    const bl = this.taill;

    this.processBlock(bh >>> 0, bl >>> 0);

    this.v2h = xor64h(this.v2h, 0);
    this.v2l = xor64l(this.v2l, 0xff);

    // 4 finalization rounds
    this.sipRound();
    this.sipRound();
    this.sipRound();
    this.sipRound();

    const rl = (this.v0l ^ this.v1l ^ this.v2l ^ this.v3l) >>> 0;
    const rh = (this.v0h ^ this.v1h ^ this.v2h ^ this.v3h) >>> 0;

    const out = new Uint8Array(8);
    out[0] = rl & 0xff;
    out[1] = (rl >>> 8) & 0xff;
    out[2] = (rl >>> 16) & 0xff;
    out[3] = (rl >>> 24) & 0xff;
    out[4] = rh & 0xff;
    out[5] = (rh >>> 8) & 0xff;
    out[6] = (rh >>> 16) & 0xff;
    out[7] = (rh >>> 24) & 0xff;
    return out;
  }

  /** Finalize and return hash as a 4-character string. */
  finishString(): string {
    const out = this.finish();
    const view = new Uint16Array(out.buffer);
    return String.fromCharCode(view[0], view[1], view[2], view[3]);
  }
}
