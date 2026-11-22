import * as THREE from "three";
import type { AtomData, BondData } from "../../types/molecule";
import { BL_CH } from "../config";
import { vseprPositions } from "../geometry";
import { bestFitPlane } from "../coplanarity";
import type { BondSpec, Hybrid } from "./spec";

/**
 * Rebuild every terminal methyl from its C-heavy-atom bond direction.
 *
 * This is a placement normalisation, not a force-field relaxation: it keeps
 * all three C-H vectors exactly tetrahedral regardless of how the surrounding
 * ring was placed. Refinement belongs to the conformer backend.
 */
export function normalizeTerminalMethyls(
  spec: BondSpec,
  hyb: readonly Hybrid[],
  atoms: AtomData[],
  bonds: readonly BondData[],
): void {
  for (let carbonIdx = 0; carbonIdx < spec.atoms.length; carbonIdx++) {
    if (spec.atoms[carbonIdx] !== "C" || hyb[carbonIdx] !== "sp3") continue;

    const attached = bonds.filter(
      (bond) => bond.atom1Idx === carbonIdx || bond.atom2Idx === carbonIdx,
    );
    const hydrogenIdxs = attached
      .map((bond) => bond.atom1Idx === carbonIdx ? bond.atom2Idx : bond.atom1Idx)
      .filter((idx) => atoms[idx].element === "H");
    const heavyIdxs = attached
      .map((bond) => bond.atom1Idx === carbonIdx ? bond.atom2Idx : bond.atom1Idx)
      .filter((idx) => atoms[idx].element !== "H");

    if (hydrogenIdxs.length !== 3 || heavyIdxs.length !== 1) continue;

    const carbon = atoms[carbonIdx];
    const heavy = atoms[heavyIdxs[0]];
    const towardHeavy = new THREE.Vector3(heavy.x - carbon.x, heavy.y - carbon.y, heavy.z - carbon.z);
    const hydrogenDirs = vseprPositions(towardHeavy, 4).slice(0, 3);
    for (let h = 0; h < hydrogenIdxs.length; h++) {
      const hydrogen = atoms[hydrogenIdxs[h]];
      hydrogen.x = carbon.x + hydrogenDirs[h].x * BL_CH;
      hydrogen.y = carbon.y + hydrogenDirs[h].y * BL_CH;
      hydrogen.z = carbon.z + hydrogenDirs[h].z * BL_CH;
    }
  }
}

/**
 * Restore the defining geometry of trigonal-planar carbon.
 *
 * The placement layer has no improper/out-of-plane term, so a carbon can keep
 * three nearly 120° angles while its bond vectors are still skewed in 3D.
 * Projecting each neighbour onto a deterministic least-squares plane fixes
 * that while preserving every C-X bond length.
 */
export function enforceSp2CarbonPlanarity(
  atoms: AtomData[],
  bonds: readonly BondData[],
): void {
  const adjacency = new Map<number, number[]>();
  for (const bond of bonds) {
    if (!adjacency.has(bond.atom1Idx)) adjacency.set(bond.atom1Idx, []);
    if (!adjacency.has(bond.atom2Idx)) adjacency.set(bond.atom2Idx, []);
    adjacency.get(bond.atom1Idx)!.push(bond.atom2Idx);
    adjacency.get(bond.atom2Idx)!.push(bond.atom1Idx);
  }
  for (const neighbors of adjacency.values()) neighbors.sort((a, b) => a - b);

  const planarCarbons = atoms
    .filter((atom) => atom.element === "C" && atom.hybridization === "sp2")
    .map((atom) => atom.index)
    .sort((a, b) => a - b);

  // A few fixed projection rounds handle fused rings and conjugated chains,
  // where correcting one centre also moves a shared sp2 neighbour.
  for (let round = 0; round < 16; round++) {
    for (const carbonIndex of planarCarbons) {
      const carbon = atoms[carbonIndex];
      const neighbors = (adjacency.get(carbonIndex) || []).filter((index) => index !== carbonIndex);
      if (neighbors.length < 3) continue;

      const center = new THREE.Vector3(carbon.x, carbon.y, carbon.z);
      const points = [center, ...neighbors.map((index) => {
        const atom = atoms[index];
        return new THREE.Vector3(atom.x, atom.y, atom.z);
      })];
      const fit = bestFitPlane(points);
      const normal = fit.normal.clone().normalize();
      if (!Number.isFinite(normal.x) || normal.lengthSq() < 1e-12) continue;

      for (const neighborIndex of neighbors) {
        const neighbor = atoms[neighborIndex];
        const vector = new THREE.Vector3(neighbor.x - carbon.x, neighbor.y - carbon.y, neighbor.z - carbon.z);
        const length = vector.length();
        if (length < 1e-8) continue;
        vector.addScaledVector(normal, -vector.dot(normal));
        if (vector.lengthSq() < 1e-12) continue;
        vector.normalize().multiplyScalar(length);
        neighbor.x = carbon.x + vector.x;
        neighbor.y = carbon.y + vector.y;
        neighbor.z = carbon.z + vector.z;
      }
    }
  }
}
