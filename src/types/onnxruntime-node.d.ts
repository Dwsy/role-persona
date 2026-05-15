declare module "onnxruntime-node" {
  export class Tensor {
    constructor(type: string, data: any, dims: number[]);
    data: any;
    dims: number[];
  }
  export class InferenceSession {
    static create(path: string, options?: any): Promise<InferenceSession>;
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  }
  export const env: {
    wasm?: any;
    webgl?: any;
  };
}
