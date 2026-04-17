declare module '*.css?inline' {
  const content: string;
  export default content;
}

declare module 'onnxruntime-web/wasm' {
  export class Tensor {
    constructor(type: 'float32' | 'int64', data: Float32Array | BigInt64Array, dims: number[]);
    readonly data: Float32Array | BigInt64Array;
  }

  export interface InferenceSession {
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  }

  export namespace InferenceSession {
    function create(
      model: ArrayBuffer,
      options?: {
        executionProviders?: string[];
        graphOptimizationLevel?: 'disabled' | 'basic' | 'extended' | 'all';
      },
    ): Promise<InferenceSession>;
  }

  export const env: {
    wasm: {
      numThreads?: number;
      wasmPaths?: string | { mjs?: string; wasm?: string };
    };
  };
}
