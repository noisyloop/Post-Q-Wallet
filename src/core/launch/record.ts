import type { LaunchConfig } from './plan';

/** bigint-safe (de)serialisation of a launch config for local storage. */
export const configToJson = (c: LaunchConfig): Record<string, unknown> => ({
  ...c, supply: c.supply.toString(), solLiquidity: c.solLiquidity.toString(),
});

export const configFromJson = (j: Record<string, unknown>): LaunchConfig => ({
  ...(j as unknown as LaunchConfig), supply: BigInt(j.supply as string), solLiquidity: BigInt(j.solLiquidity as string),
});
