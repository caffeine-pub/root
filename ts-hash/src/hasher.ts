import { SipHash } from "./siphash.js";

const SIPHASH_KEY = new Uint8Array([
  // fixed key for deterministic hashing. doesn't need to be secret since we're
  // not using this for security, just memoization.
  0xc6, 0xa4, 0xa7, 0x93, 0x51, 0x4e, 0x20, 0xbf,
  0x9d, 0xf5, 0x1a, 0x72, 0x3b, 0xad, 0x5c, 0x0d,
]);

const encoder = new TextEncoder();

export class Hasher {
  private state: SipHash;

  constructor() {
    this.state = new SipHash(SIPHASH_KEY);
  }

  /** Hash a string value (length-prefixed). */
  str(value: string): this {
    const encoded = encoder.encode(value);
    this.state.writeU32(encoded.byteLength);
    this.state.write(encoded);
    return this;
  }

  /** Hash a number (as float64). */
  f64(value: number): this {
    this.state.writeF64(value);
    return this;
  }

  /** Hash an integer (as uint32). */
  u32(value: number): this {
    this.state.writeU32(value);
    return this;
  }

  /** Hash a single byte. */
  u8(value: number): this {
    this.state.writeU8(value);
    return this;
  }

  /** Hash a boolean. */
  bool(value: boolean): this {
    return this.u8(value ? 1 : 0);
  }

  /** Hash a bigint (variable-length, tagged + length-prefixed). */
  bigint(value: bigint): this {
    const negative = value < 0n;
    const abs = negative ? -value : value;
    const hex = abs.toString(16);
    const byteLength = Math.ceil(hex.length / 2);
    const buf = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i++) {
      const offset = hex.length - 2 * (i + 1);
      const slice =
        offset < 0 ? hex.slice(0, offset + 2) : hex.slice(offset, offset + 2);
      buf[i] = parseInt(slice, 16);
    }
    this.u8(negative ? 1 : 0);
    this.u32(byteLength);
    this.state.write(buf);
    return this;
  }

  /** Hash null (as a tag byte). */
  null(): this {
    return this.u8(0);
  }

  /** Hash undefined (as a tag byte). */
  undefined(): this {
    return this.u8(1);
  }

  /** Hash raw bytes (length-prefixed). */
  bytes(value: Uint8Array): this {
    this.state.writeU32(value.byteLength);
    this.state.write(value);
    return this;
  }

  /** Finalize and return the hash as a 4-character string. */
  finish(): string {
    return this.state.finishString();
  }

  /** Finalize and return the hash as raw bytes. */
  finishBytes(): Uint8Array {
    return this.state.finish();
  }

  /** Convenience: hash and return in one step. */
  static hash(fn: (h: Hasher) => void): string {
    const h = new Hasher();
    fn(h);
    return h.finish();
  }
}
