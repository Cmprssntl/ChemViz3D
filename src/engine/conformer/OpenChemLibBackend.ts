import { ConformerGenerator, ForceFieldMMFF94, Molecule, Resources } from "openchemlib";
import type { AtomData, BondData } from "../../types/molecule";
import { ATOMIC_DATA } from "../../utils/formulaParser";
import { GeometryValidator } from "../relax/GeometryValidator";
import { ConstrainedMinimizer } from "../relax/ConstrainedMinimizer";
import {
  atomicNumberFromElement,
  ConformerBackend,
  elementFromAtomicNumber,
  type ConformerInput,
  type ConformerOptions,
  type ConformerOutput,
} from "./ConformerBackend";
import resources from "./ocl-resources.generated.json";

const DEFAULT_SEED = 0x5eed;
const LARGE_MOLECULE_ATOMS = 80;

/**
 * Primary backend: OpenChemLib's knowledge-based conformer generator followed
 * by an MMFF94 minimisation. It replaces the hand-rolled VSEPR placement and
 * the numeric-gradient UFF that stretched large structures by thousands of Å.
 */
export class OpenChemLibBackend extends ConformerBackend {
  readonly id = "openchemlib";

  private static resourcesRegistered = false;
  private readonly validator = new GeometryValidator();

  isAvailable(): boolean {
    return true;
  }

  build(input: ConformerInput, options: ConformerOptions = {}): ConformerOutput | null {
    if (input.elements.length === 0) return null;
    OpenChemLibBackend.registerResources();
    const warnings: string[] = [];
    const molecule = this.createMolecule(input, warnings);
    if (!molecule) return null;

    const generated = this.generateConformer(molecule, options.seed ?? DEFAULT_SEED);
    if (!generated) return null;

    if (!options.skipMinimise) {
      const iterations = options.maxIterations
        ?? (input.elements.length > LARGE_MOLECULE_ATOMS ? 150 : 400);
      this.minimise(generated, iterations, warnings);
    }

    const output = this.readBack(generated, input, warnings);
    const report = this.validator.validate(output.atoms, output.bonds);
    if (!report.ok) return null;
    return output;
  }

  /**
   * Second stage. MMFF94 runs in short chunks with a yield between them so the
   * viewer keeps responding; very large structures use the constrained
   * minimizer because MMFF94 scales poorly beyond ~200 heavy atoms.
   */
  async refine(
    input: ConformerInput,
    coarse: ConformerOutput,
    options: ConformerOptions = {},
  ): Promise<ConformerOutput | null> {
    if (options.useConstrained) return this.refineConstrained(coarse, options);

    const molecule = this.fromOutput(coarse);
    if (!molecule) return null;
    const warnings: string[] = [];
    const total = Math.max(1, options.maxIterations ?? 120);
    const chunk = Math.max(1, options.chunkIterations ?? 10);
    try {
      const forceField = new ForceFieldMMFF94(molecule, "MMFF94");
      for (let done = 0; done < total; done += chunk) {
        const code = forceField.minimise({
          maxIts: Math.min(chunk, total - done),
          gradTol: 1e-3,
          funcTol: 1e-4,
        });
        if (code === 0) break;
        await yieldToMain();
      }
    } catch (error) {
      warnings.push(`MMFF94 refinement skipped: ${message(error)}`);
    }

    const output = this.readBack(molecule, input, warnings);
    const report = this.validator.validate(output.atoms, output.bonds);
    return report.ok ? output : null;
  }

  private refineConstrained(coarse: ConformerOutput, options: ConformerOptions): ConformerOutput {
    const minimizer = new ConstrainedMinimizer();
    const result = minimizer.minimize(coarse.atoms, coarse.bonds, {
      maxIterations: options.maxIterations ?? 120,
    });
    const warnings = result.accepted
      ? []
      : ["Constrained refinement did not converge; using coarse geometry"];
    return {
      atoms: result.accepted ? result.atoms : coarse.atoms,
      bonds: coarse.bonds,
      backend: this.id,
      warnings,
    };
  }

  private static registerResources(): void {
    if (OpenChemLibBackend.resourcesRegistered) return;
    Resources.register(resources as unknown as Record<string, string>);
    OpenChemLibBackend.resourcesRegistered = true;
  }

  private createMolecule(input: ConformerInput, warnings: string[]): Molecule | null {
    try {
      const molecule = new Molecule(input.elements.length + 16, input.bonds.length + 32);
      for (let index = 0; index < input.elements.length; index++) {
        const atom = molecule.addAtom(atomicNumberFromElement(input.elements[index]));
        const charge = input.charges?.[index];
        if (charge) molecule.setAtomCharge(atom, charge);
      }
      for (const [a, b, order] of input.bonds) {
        if (a === b) continue;
        const bond = molecule.addBond(a, b);
        if (order === 1.5) warnings.push("Aromatic bond order normalised to single");
        molecule.setBondOrder(bond, Math.max(1, Math.round(order)));
      }
      molecule.ensureHelperArrays(Molecule.cHelperParities);
      return molecule;
    } catch (error) {
      warnings.push(`OpenChemLib could not build the graph: ${message(error)}`);
      return null;
    }
  }

  private generateConformer(molecule: Molecule, seed: number): Molecule | null {
    try {
      const generator = new ConformerGenerator(seed);
      return generator.getOneConformerAsMolecule(molecule);
    } catch {
      return null;
    }
  }

  /** Rebuild an OCL molecule from a coarse output, including explicit H atoms. */
  private fromOutput(output: ConformerOutput): Molecule | null {
    try {
      const molecule = new Molecule(output.atoms.length + 8, output.bonds.length + 8);
      for (const atom of output.atoms) {
        const index = molecule.addAtom(atomicNumberFromElement(atom.element));
        if (atom.charge) molecule.setAtomCharge(index, atom.charge);
        molecule.setAtomX(index, atom.x);
        molecule.setAtomY(index, atom.y);
        molecule.setAtomZ(index, atom.z);
      }
      for (const bond of output.bonds) {
        if (bond.atom1Idx === bond.atom2Idx) continue;
        const index = molecule.addBond(bond.atom1Idx, bond.atom2Idx);
        molecule.setBondOrder(index, Math.max(1, Math.round(bond.order)));
      }
      molecule.ensureHelperArrays(Molecule.cHelperParities);
      return molecule;
    } catch {
      return null;
    }
  }

  private minimise(molecule: Molecule, maxIterations: number, warnings: string[]): void {
    try {
      const forceField = new ForceFieldMMFF94(molecule, "MMFF94");
      const code = forceField.minimise({ maxIts: maxIterations, gradTol: 1e-3, funcTol: 1e-4 });
      if (code !== 0) warnings.push(`MMFF94 stopped with code ${code}`);
    } catch (error) {
      warnings.push(`MMFF94 refinement skipped: ${message(error)}`);
    }
  }

  private readBack(molecule: Molecule, input: ConformerInput, warnings: string[]): ConformerOutput {
    const atoms: AtomData[] = [];
    const heavyCount = input.elements.length;
    for (let index = 0; index < molecule.getAllAtoms(); index++) {
      const element = elementFromAtomicNumber(molecule.getAtomicNo(index));
      const atomic = ATOMIC_DATA[element];
      const isHeavy = index < heavyCount;
      atoms.push({
        index,
        element,
        x: molecule.getAtomX(index),
        y: molecule.getAtomY(index),
        z: molecule.getAtomZ(index),
        covalentRadius: atomic?.covalentRadius ?? 76,
        vdwRadius: atomic?.vdwRadius ?? 170,
        ...(molecule.getAtomCharge(index) ? { charge: molecule.getAtomCharge(index) } : {}),
        ...(isHeavy && input.hybridizations?.[index]
          ? { hybridization: input.hybridizations[index] }
          : {}),
      });
    }

    const bonds: BondData[] = [];
    for (let index = 0; index < molecule.getAllBonds(); index++) {
      const a = molecule.getBondAtom(0, index);
      const b = molecule.getBondAtom(1, index);
      bonds.push({
        index,
        atom1Idx: a,
        atom2Idx: b,
        order: Math.max(1, molecule.getBondOrder(index)),
      });
    }
    if (atoms.length > heavyCount + 64) {
      warnings.push("Backend added an unexpected number of hydrogens");
    }
    return { atoms, bonds, backend: this.id, warnings };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Yield one macrotask so the renderer can paint between MMFF94 chunks. */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
