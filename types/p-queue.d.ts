declare module 'p-queue' {
  export interface Options {
    interval?: number;
    intervalCap?: number;
    concurrency?: number;
  }

  export default class PQueue {
    constructor(options?: Options);
    add<T>(fn: () => Promise<T> | T): Promise<T>; // ✅ Always return Promise<T>
    onEmpty(): Promise<void>;
    onIdle(): Promise<void>;
    clear(): void;
  }
}
