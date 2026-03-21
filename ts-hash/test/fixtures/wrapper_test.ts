/** @hash */
export type LinkedList<T> = { value: T; next: LinkedList<T> | null };

/** @hash */
export type Wrapper = { inner: LinkedList<string> };
