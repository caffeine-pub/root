/**
 * A compact bitset backed by a Uint32Array.
 */
export class BitSet {
  private words: Uint32Array;

  constructor(initialCapacity: number = 0) {
    this.words = new Uint32Array(((initialCapacity + 31) >>> 5) || 1);
  }

  /**
   * Ensure the bitset can hold at least `index + 1` bits.
   */
  resize(index: number): void {
    const needed = (index >>> 5) + 1;
    if (needed > this.words.length) {
      // grow by at least 2x to amortize
      const newSize = Math.max(needed, this.words.length * 2);
      const newWords = new Uint32Array(newSize);
      newWords.set(this.words);
      this.words = newWords;
    }
  }

  /**
   * Set the bit at index to true.
   */
  add(index: number): void {
    this.resize(index);
    this.words[index >>> 5] |= 1 << index;
  }

  /**
   * Set the bit at index to false.
   */
  remove(index: number): void {
    if ((index >>> 5) < this.words.length) {
      this.words[index >>> 5] &= ~(1 << index);
    }
  }

  /**
   * Is the bit at index true?
   */
  has(index: number): boolean {
    return (this.words[index >>> 5] & (1 << index)) !== 0;
  }

  /**
   * Set all bits to false.
   */
  clear(): void {
    this.words.fill(0);
  }
}
