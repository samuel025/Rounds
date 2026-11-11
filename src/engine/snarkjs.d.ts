declare module "snarkjs" {
  export const groth16: {
    fullProve(input: Record<string, unknown>, wasm: string | Uint8Array, zkey: string | Uint8Array, logger?: unknown): Promise<{ proof: any; publicSignals: string[] }>;
    verify(vkey: any, publicSignals: string[], proof: any): Promise<boolean>;
  };
}
declare module "circomlibjs" {
  export function buildPoseidon(): Promise<any>;
}
