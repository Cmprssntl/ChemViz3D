import type { MoleculeData } from "../../types/molecule";
import { detectPrincipal } from "./FunctionalGroups";
import { HeavyMolecule } from "./HeavyMolecule";
import { assembleName } from "./NameAssembler";
import { NamingError } from "./NamingError";
import { selectParent } from "./ParentSelector";

export { NamingError } from "./NamingError";
export type { NamingErrorCode } from "./NamingError";

/**
 * Deterministic IUPAC-style namer for the structures ChemViz3D can build.
 *
 * It never guesses: an unsupported skeleton or functional group raises a typed
 * `NamingError` that the UI displays instead of substituting a formula or
 * SMILES for the name.
 */
export class IupacNamer {
  name(molecule: MoleculeData): string {
    const heavy = HeavyMolecule.fromMolecule(molecule);
    if (heavy.size === 0) throw new NamingError("empty-structure");
    const principal = detectPrincipal(heavy);
    const parent = selectParent(heavy, principal);
    return assembleName(parent, principal);
  }

  /** Convenience wrapper for callers that want the failure as data. */
  tryName(molecule: MoleculeData): { name: string } | { error: NamingError } {
    try {
      return { name: this.name(molecule) };
    } catch (error) {
      if (error instanceof NamingError) return { error };
      throw error;
    }
  }
}

export const iupacNamer = new IupacNamer();
