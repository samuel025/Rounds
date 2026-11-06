export interface Waterfall { classes: Record<string, { shares: bigint; preferenceMicro: bigint }>; commonShares: Record<string, bigint>; proceedsMicro: bigint }
export interface WaterfallResult { converts: string[]; payoutsMicro: Record<string, bigint>; remainderMicro: bigint }
export function waterfall(_w: Waterfall): WaterfallResult { throw new Error("unimplemented: waterfall (M2)"); }
