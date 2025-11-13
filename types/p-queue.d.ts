declare module 'p-queue' {
  import { PromiseLike } from 'es6-promise';

  export interface Options {
    interval?: number;
    intervalCap?: number;
    concurrency?: number;
  }

  export default class PQueue {
    constructor(options?: Options);
    add<T>(fn: () => Promise<T> | T): Promise<T>; // ✅ Fix: always return Promise<T>, never void
    onEmpty(): Promise<void>;
    onIdle(): Promise<void>;
    clear(): void;
  }
}
