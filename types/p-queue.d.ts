declare module 'p-queue' {
  export interface Options {
    interval?: number;
    intervalCap?: number;
    concurrency?: number;
  }

  export default class PQueue {
    constructor(options?: Options);

    /** FORCE add() to only return Promise<T> */
    add<T = any>(fn: () => Promise<T>): Promise<T>;

    onEmpty(): Promise<void>;
    onIdle(): Promise<void>;
    clear(): void;
  }
}
