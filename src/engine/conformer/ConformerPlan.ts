import type { ConformerInput } from "./ConformerBackend";

export type ConformerQuality = "coarse" | "balanced" | "fine";

/**
 * How a structure is generated.
 *
 * Fine structures get the full MMFF94 treatment before they are shown.
 * Balanced and coarse structures return the knowledge-based conformer first
 * and refine it afterwards, so the first frame is not blocked by a long
 * minimisation. Very large structures use the constrained minimizer instead of
 * MMFF94, which grows super-linearly with atom count.
 */
export interface ConformerPlan {
  quality: ConformerQuality;
  heavyAtomCount: number;
  ringCount: number;
  /** Run MMFF94 before returning the first geometry. */
  initialMinimise: boolean;
  /** Iteration budget for the initial MMFF94 pass (0 when skipped). */
  initialIterations: number;
  /** Whether a background refinement should run. */
  refine: boolean;
  /** Iteration budget for the background refinement. */
  refineIterations: number;
  /** Use `ConstrainedMinimizer` instead of MMFF94 for the background pass. */
  refineWithConstrained: boolean;
}

const FINE_MAX_HEAVY = 60;
const BALANCED_MAX_HEAVY = 200;
const FINE_MAX_RINGS = 8;

/** Heavy-atom ring count; connected inputs make this exact. */
export function ringCountOf(input: ConformerInput): number {
  return Math.max(0, input.bonds.length - input.elements.length + 1);
}

export function planConformer(input: ConformerInput): ConformerPlan {
  const heavy = input.elements.length;
  const rings = ringCountOf(input);

  if (heavy <= FINE_MAX_HEAVY && rings <= FINE_MAX_RINGS) {
    return {
      quality: "fine",
      heavyAtomCount: heavy,
      ringCount: rings,
      initialMinimise: true,
      initialIterations: 400,
      refine: false,
      refineIterations: 0,
      refineWithConstrained: false,
    };
  }

  if (heavy <= BALANCED_MAX_HEAVY) {
    return {
      quality: "balanced",
      heavyAtomCount: heavy,
      ringCount: rings,
      initialMinimise: false,
      initialIterations: 0,
      refine: true,
      refineIterations: heavy <= 120 ? 120 : 60,
      refineWithConstrained: false,
    };
  }

  return {
    quality: "coarse",
    heavyAtomCount: heavy,
    ringCount: rings,
    initialMinimise: false,
    initialIterations: 0,
    refine: true,
    refineIterations: 120,
    refineWithConstrained: true,
  };
}
