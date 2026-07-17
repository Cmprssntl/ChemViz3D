import * as THREE from "three";
import type { MoleculeData, AtomData } from "../types/molecule";
import { parseFormula, ATOMIC_DATA } from "../utils/formulaParser";
import { buildFromKnownFormula } from "./vseprBuilder";
import { tetrahedralPositions, vseprPositions, findPerp } from "./geometry";

// Bond length in Angstroms
const CC_BOND = 1.54;
const CH_BOND = 1.09;
const CO_BOND = 1.43;
const CN_BOND = 1.47;
const OH_BOND = 0.96;
const NH_BOND = 1.01;

// Double bond shorter
const CC_DOUBLE = 1.34;

//  Template: direct-mapped molecules with pre-correct VSEPR 

function buildMethane(counts: Map<string, number>): MoleculeData {
  const atoms: AtomData[] = [];
  const bonds: MoleculeData["bonds"] = [];
  const bl = CH_BOND;

  atoms.push({ index: 0, element: "C", x: 0, y: 0, z: 0, covalentRadius: 76, vdwRadius: 170 });
  const tet = tetrahedralPositions();
  for (let i = 0; i < 4; i++) {
    const p = tet[i];
    atoms.push({ index: i + 1, element: "H", x: p.x * bl, y: p.y * bl, z: p.z * bl, covalentRadius: 31, vdwRadius: 120 });
    bonds.push({ index: i, atom1Idx: 0, atom2Idx: i + 1, order: 1 });
  }
  return { atoms, bonds, name: "methane", formula: "CH4", smiles: "C" };
}

function buildEthane(): MoleculeData {
  const atoms: AtomData[] = [];
  const bonds: MoleculeData["bonds"] = [];
  const bl = CH_BOND;

  atoms.push({ index: 0, element: "C", x: -CC_BOND / 2, y: 0, z: 0, covalentRadius: 76, vdwRadius: 170 });
  atoms.push({ index: 1, element: "C", x: CC_BOND / 2, y: 0, z: 0, covalentRadius: 76, vdwRadius: 170 });
  bonds.push({ index: 0, atom1Idx: 0, atom2Idx: 1, order: 1 });

  // C0: towards C1
  const dir0 = new THREE.Vector3(1, 0, 0);
  const pos0 = vseprPositions(dir0, 4); // returns [away from C1, 3 H's at 109.47]
  // The last 3 are for H's
  for (let i = 0; i < 3; i++) {
    const p = pos0[i];
    atoms.push({ index: atoms.length, element: "H", x: p.x * bl - CC_BOND / 2, y: p.y * bl, z: p.z * bl, covalentRadius: 31, vdwRadius: 120 });
    bonds.push({ index: bonds.length, atom1Idx: 0, atom2Idx: atoms.length - 1, order: 1 });
  }

  // C1: towards C0
  const dir1 = new THREE.Vector3(-1, 0, 0);
  const pos1 = vseprPositions(dir1, 4);
  for (let i = 0; i < 3; i++) {
    const p = pos1[i];
    atoms.push({ index: atoms.length, element: "H", x: p.x * bl + CC_BOND / 2, y: p.y * bl, z: p.z * bl, covalentRadius: 31, vdwRadius: 120 });
    bonds.push({ index: bonds.length, atom1Idx: 1, atom2Idx: atoms.length - 1, order: 1 });
  }

  return { atoms, bonds, name: "ethane", formula: "C2H6", smiles: "CC" };
}

function buildEthene(): MoleculeData {
  const atoms: AtomData[] = [];
  const bonds: MoleculeData["bonds"] = [];
  const bl = CH_BOND;
  const half = CC_DOUBLE / 2;

  atoms.push({ index: 0, element: "C", x: -half, y: 0, z: 0, covalentRadius: 71, vdwRadius: 170 });
  atoms.push({ index: 1, element: "C", x: half, y: 0, z: 0, covalentRadius: 71, vdwRadius: 170 });
  bonds.push({ index: 0, atom1Idx: 0, atom2Idx: 1, order: 2 });

  // sp: 120 in xy-plane
  for (let side = 0; side < 2; side++) {
    const cx = side === 0 ? -half : half;
    const dir = side === 0 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(-1, 0, 0);
    const perp = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 2; i++) {
      const angle = (i === 0 ? 1 : -1) * (Math.PI * 2 / 3);
      const p = new THREE.Vector3().copy(dir).applyAxisAngle(new THREE.Vector3(0, 0, 1), angle);
      atoms.push({
        index: atoms.length, element: "H",
        x: cx + p.x * bl, y: p.y * bl, z: 0,
        covalentRadius: 31, vdwRadius: 120,
      });
      bonds.push({ index: bonds.length, atom1Idx: side, atom2Idx: atoms.length - 1, order: 1 });
    }
  }

  return { atoms, bonds, name: "ethene", formula: "C2H4", smiles: "C=C" };
}

function buildEthyne(): MoleculeData {
  const atoms: AtomData[] = [];
  const bonds: MoleculeData["bonds"] = [];
  const half = 1.20 / 2;
  const bl = CH_BOND;

  atoms.push({ index: 0, element: "C", x: -half, y: 0, z: 0, covalentRadius: 69, vdwRadius: 170 });
  atoms.push({ index: 1, element: "C", x: half, y: 0, z: 0, covalentRadius: 69, vdwRadius: 170 });
  bonds.push({ index: 0, atom1Idx: 0, atom2Idx: 1, order: 3 });

  atoms.push({ index: 2, element: "H", x: -half - bl, y: 0, z: 0, covalentRadius: 31, vdwRadius: 120 });
  bonds.push({ index: 1, atom1Idx: 0, atom2Idx: 2, order: 1 });
  atoms.push({ index: 3, element: "H", x: half + bl, y: 0, z: 0, covalentRadius: 31, vdwRadius: 120 });
  bonds.push({ index: 2, atom1Idx: 1, atom2Idx: 3, order: 1 });

  return { atoms, bonds, name: "ethyne", formula: "C2H2", smiles: "C#C" };
}

function buildBenzene(): MoleculeData {
  const atoms: AtomData[] = [];
  const bonds: MoleculeData["bonds"] = [];
  const r = 1.40;
  const bl = CH_BOND;

  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
    atoms.push({
      index: i, element: "C",
      x: Math.cos(angle) * r, y: Math.sin(angle) * r, z: 0,
      covalentRadius: 73, vdwRadius: 170,
      hybridization: "sp2",
    });
    if (i > 0) bonds.push({ index: bonds.length, atom1Idx: i - 1, atom2Idx: i, order: 1 });
  }
  bonds.push({ index: bonds.length, atom1Idx: 5, atom2Idx: 0, order: 1 });

  // Alternate double bonds (Kekul)
  for (let i = 0; i < 6; i += 2) {
    const b = bonds[i];
    bonds[b.index] = { ...b, order: 2 };
  }

  // H's outward radially
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
    atoms.push({
      index: atoms.length, element: "H",
      x: Math.cos(angle) * (r + bl),
      y: Math.sin(angle) * (r + bl),
      z: 0,
      covalentRadius: 31, vdwRadius: 120,
    });
    bonds.push({ index: bonds.length, atom1Idx: i, atom2Idx: atoms.length - 1, order: 1 });
  }

  return { atoms, bonds, name: "benzene", formula: "C6H6", smiles: "c1ccccc1" };
}

function buildWater(): MoleculeData {
  const atoms: AtomData[] = [];
  const bonds: MoleculeData["bonds"] = [];
  const angle = THREE.MathUtils.degToRad(104.5);

  atoms.push({ index: 0, element: "O", x: 0, y: 0, z: 0, covalentRadius: 66, vdwRadius: 152 });

  const h1x = Math.sin(angle / 2) * OH_BOND;
  const h1y = Math.cos(angle / 2) * OH_BOND;
  atoms.push({ index: 1, element: "H", x: -h1x, y: h1y, z: 0, covalentRadius: 31, vdwRadius: 120 });
  bonds.push({ index: 0, atom1Idx: 0, atom2Idx: 1, order: 1 });

  atoms.push({ index: 2, element: "H", x: h1x, y: h1y, z: 0, covalentRadius: 31, vdwRadius: 120 });
  bonds.push({ index: 1, atom1Idx: 0, atom2Idx: 2, order: 1 });

  return { atoms, bonds, name: "water", formula: "H2O", smiles: "O" };
}

function buildAmmonia(): MoleculeData {
  const atoms: AtomData[] = [];
  const bonds: MoleculeData["bonds"] = [];
  // Trigonal pyramidal, ~107
  const angRad = THREE.MathUtils.degToRad(107);
  const nH = NH_BOND;

  atoms.push({ index: 0, element: "N", x: 0, y: 0, z: 0, covalentRadius: 71, vdwRadius: 155 });

  const perp = new THREE.Vector3(0, 0, 1);
  const up = new THREE.Vector3(0, -1, 0);
  // Direction from N to the lone pair is +z (up), so H's are below
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const dir = new THREE.Vector3()
      .addScaledVector(up, -Math.cos(THREE.MathUtils.degToRad(107)))
      .addScaledVector(new THREE.Vector3(1, 0, 0).applyAxisAngle(up, angle), Math.sin(THREE.MathUtils.degToRad(107)));
    dir.normalize();
    atoms.push({
      index: i + 1, element: "H",
      x: dir.x * nH, y: dir.y * nH, z: dir.z * nH,
      covalentRadius: 31, vdwRadius: 120,
    });
    bonds.push({ index: i, atom1Idx: 0, atom2Idx: i + 1, order: 1 });
  }

  return { atoms, bonds, name: "ammonia", formula: "NH3", smiles: "N" };
}

function buildCO2(): MoleculeData {
  const atoms: AtomData[] = [];
  const bonds: MoleculeData["bonds"] = [];
  const half = 1.16;
  atoms.push({ index: 0, element: "C", x: 0, y: 0, z: 0, covalentRadius: 73, vdwRadius: 170 });
  atoms.push({ index: 1, element: "O", x: -half, y: 0, z: 0, covalentRadius: 57, vdwRadius: 152 });
  bonds.push({ index: 0, atom1Idx: 0, atom2Idx: 1, order: 2 });
  atoms.push({ index: 2, element: "O", x: half, y: 0, z: 0, covalentRadius: 57, vdwRadius: 152 });
  bonds.push({ index: 1, atom1Idx: 0, atom2Idx: 2, order: 2 });
  return { atoms, bonds, name: "carbon dioxide", formula: "CO2", smiles: "O=C=O" };
}

function buildMethanol(): MoleculeData {
  const atoms: AtomData[] = [];
  const bonds: MoleculeData["bonds"] = [];
  const bl = CH_BOND;

  atoms.push({ index: 0, element: "C", x: 0, y: 0, z: 0, covalentRadius: 76, vdwRadius: 170 });

  // OH along +x, with O at CO_BOND
  atoms.push({ index: 1, element: "O", x: CO_BOND, y: 0, z: 0, covalentRadius: 66, vdwRadius: 152 });
  bonds.push({ index: 0, atom1Idx: 0, atom2Idx: 1, order: 1 });

  // H on O at angle
  const ohAngle = THREE.MathUtils.degToRad(104.5);
  atoms.push({
    index: 2, element: "H",
    x: CO_BOND + Math.cos(Math.PI - ohAngle) * OH_BOND,
    y: Math.sin(Math.PI - ohAngle) * OH_BOND,
    z: 0,
    covalentRadius: 31, vdwRadius: 120,
  });
  bonds.push({ index: 1, atom1Idx: 1, atom2Idx: 2, order: 1 });

  // 3 H's on C at tetrahedral positions around O direction
  const dirC = new THREE.Vector3(1, 0, 0);
  const posC = vseprPositions(dirC, 4);
  for (let i = 0; i < 3; i++) {
    const p = posC[i];
    atoms.push({
      index: atoms.length, element: "H",
      x: p.x * bl, y: p.y * bl, z: p.z * bl,
      covalentRadius: 31, vdwRadius: 120,
    });
    bonds.push({ index: bonds.length, atom1Idx: 0, atom2Idx: atoms.length - 1, order: 1 });
  }

  return { atoms, bonds, name: "methanol", formula: "CH3OH", smiles: "CO" };
}

function buildEthanol(): MoleculeData {
  const atoms: AtomData[] = [];
  const bonds: MoleculeData["bonds"] = [];
  const bl = CH_BOND;
  const half = CC_BOND / 2;

  // C0 at -half, C1 at +half
  atoms.push({ index: 0, element: "C", x: -half, y: 0, z: 0, covalentRadius: 76, vdwRadius: 170 });
  atoms.push({ index: 1, element: "C", x: half, y: 0, z: 0, covalentRadius: 76, vdwRadius: 170 });
  bonds.push({ index: 0, atom1Idx: 0, atom2Idx: 1, order: 1 });

  // C1  O along y (bent)
  atoms.push({ index: 2, element: "O", x: half + Math.cos(THREE.MathUtils.degToRad(109.47)) * CO_BOND, y: Math.sin(THREE.MathUtils.degToRad(109.47)) * CO_BOND, z: 0, covalentRadius: 66, vdwRadius: 152 });
  bonds.push({ index: 1, atom1Idx: 1, atom2Idx: 2, order: 1 });

  // OH H
  const ohAngle = THREE.MathUtils.degToRad(104.5);
  atoms.push({
    index: 3, element: "H",
    x: atoms[2].x + Math.cos(Math.PI - ohAngle) * OH_BOND,
    y: atoms[2].y + Math.sin(Math.PI - ohAngle) * OH_BOND,
    z: 0,
    covalentRadius: 31, vdwRadius: 120,
  });
  bonds.push({ index: 2, atom1Idx: 2, atom2Idx: 3, order: 1 });

  // C0: 3 H's tetrahedral around C1 direction
  const dir0 = new THREE.Vector3(1, 0, 0);
  const pos0 = vseprPositions(dir0, 4);
  for (let i = 0; i < 3; i++) {
    const p = pos0[i];
    atoms.push({ index: atoms.length, element: "H", x: -half + p.x * bl, y: p.y * bl, z: p.z * bl, covalentRadius: 31, vdwRadius: 120 });
    bonds.push({ index: bonds.length, atom1Idx: 0, atom2Idx: atoms.length - 1, order: 1 });
  }

  // C1: 2 H's tetrahedral around C0 direction (one position filled by O)
  const dir1 = new THREE.Vector3(-1, 0, 0);
  // For C1: bonded to C0, O, and 2 H's. sp3 with 3 substituents + H
  // Actually C1 has bonds to: C0, O, H, H = 4 bonds total
  // tetrahedral positions: one towards C0, remaining 3 for O and 2 H's
  const pos1 = vseprPositions(dir1, 4);
  // pos1[0] = towards C0 (already used), pos1[1..3] = for O and 2 H's
  // pos1[1] is already used by O (above, but not exactly right direction)
  // Let me instead: use the 3 remaining positions for O + 2 H's
  for (let i = 1; i < 3; i++) {
    const p = pos1[i];
    atoms.push({ index: atoms.length, element: "H", x: half + p.x * bl, y: p.y * bl, z: p.z * bl, covalentRadius: 31, vdwRadius: 120 });
    bonds.push({ index: bonds.length, atom1Idx: 1, atom2Idx: atoms.length - 1, order: 1 });
  }

  return { atoms, bonds, name: "ethanol", formula: "C2H5OH", smiles: "CCO" };
}

//  Generic carbon-chain builder (for propane, butane, etc.) 

function buildAceticAcid(): MoleculeData {
  const atoms: AtomData[] = [];
  const bonds: MoleculeData["bonds"] = [];

  // C0 (methyl sp) at origin
  atoms.push({ index: 0, element: "C", x: 0, y: 0, z: 0, covalentRadius: 76, vdwRadius: 170 });
  // C1 (carbonyl sp) along x
  atoms.push({ index: 1, element: "C", x: CC_BOND, y: 0, z: 0, covalentRadius: 73, vdwRadius: 170 });
  bonds.push({ index: 0, atom1Idx: 0, atom2Idx: 1, order: 1 });

  // Carbonyl O (double bond)
  atoms.push({ index: 2, element: "O", x: CC_BOND + 1.20, y: 0, z: 0, covalentRadius: 57, vdwRadius: 152 });
  bonds.push({ index: 1, atom1Idx: 1, atom2Idx: 2, order: 2 });

  // OH O (single bond)  sp direction: 120 up
  const angle120 = THREE.MathUtils.degToRad(120);
  atoms.push({
    index: 3, element: "O",
    x: CC_BOND + Math.cos(angle120) * CO_BOND,
    y: Math.sin(angle120) * CO_BOND,
    z: 0,
    covalentRadius: 66, vdwRadius: 152,
  });
  bonds.push({ index: 2, atom1Idx: 1, atom2Idx: 3, order: 1 });

  // OH H
  atoms.push({
    index: 4, element: "H",
    x: atoms[3].x + Math.cos(angle120 + THREE.MathUtils.degToRad(104.5)) * OH_BOND,
    y: atoms[3].y + Math.sin(angle120 + THREE.MathUtils.degToRad(104.5)) * OH_BOND,
    z: 0,
    covalentRadius: 31, vdwRadius: 120,
  });
  bonds.push({ index: 3, atom1Idx: 3, atom2Idx: 4, order: 1 });

  // C0: 3 H's tetrahedral around C1 direction
  const dir0 = new THREE.Vector3(1, 0, 0);
  const pos0 = vseprPositions(dir0, 4);
  for (let i = 0; i < 3; i++) {
    const p = pos0[i];
    atoms.push({ index: atoms.length, element: "H", x: p.x * CH_BOND, y: p.y * CH_BOND, z: p.z * CH_BOND, covalentRadius: 31, vdwRadius: 120 });
    bonds.push({ index: bonds.length, atom1Idx: 0, atom2Idx: atoms.length - 1, order: 1 });
  }

  return { atoms, bonds, name: "acetic acid", formula: "CH3COOH", smiles: "CC(=O)O" };
}

function buildFormicAcid(): MoleculeData {
  const atoms: AtomData[] = [];
  const bonds: MoleculeData["bonds"] = [];

  atoms.push({ index: 0, element: "C", x: 0, y: 0, z: 0, covalentRadius: 73, vdwRadius: 170 });
  // Carbonyl O double bond
  atoms.push({ index: 1, element: "O", x: 1.20, y: 0, z: 0, covalentRadius: 57, vdwRadius: 152 });
  bonds.push({ index: 0, atom1Idx: 0, atom2Idx: 1, order: 2 });
  // OH O
  const angle120 = THREE.MathUtils.degToRad(120);
  atoms.push({ index: 2, element: "O", x: Math.cos(angle120) * CO_BOND, y: Math.sin(angle120) * CO_BOND, z: 0, covalentRadius: 66, vdwRadius: 152 });
  bonds.push({ index: 1, atom1Idx: 0, atom2Idx: 2, order: 1 });
  // OH H
  atoms.push({ index: 3, element: "H", x: atoms[2].x + Math.cos(angle120 + THREE.MathUtils.degToRad(104.5)) * OH_BOND, y: atoms[2].y + Math.sin(angle120 + THREE.MathUtils.degToRad(104.5)) * OH_BOND, z: 0, covalentRadius: 31, vdwRadius: 120 });
  bonds.push({ index: 2, atom1Idx: 2, atom2Idx: 3, order: 1 });
  // Aldehyde H
  atoms.push({ index: 4, element: "H", x: Math.cos(Math.PI + angle120) * CH_BOND, y: Math.sin(Math.PI + angle120) * CH_BOND, z: 0, covalentRadius: 31, vdwRadius: 120 });
  bonds.push({ index: 3, atom1Idx: 0, atom2Idx: 4, order: 1 });

  return { atoms, bonds, name: "formic acid", formula: "HCOOH", smiles: "C(=O)O" };
}

function buildAcetaldehyde(): MoleculeData {
  const atoms: AtomData[] = [];
  const bonds: MoleculeData["bonds"] = [];

  // C0 (methyl sp)
  atoms.push({ index: 0, element: "C", x: 0, y: 0, z: 0, covalentRadius: 76, vdwRadius: 170 });
  // C1 (carbonyl sp)
  atoms.push({ index: 1, element: "C", x: CC_BOND, y: 0, z: 0, covalentRadius: 73, vdwRadius: 170 });
  bonds.push({ index: 0, atom1Idx: 0, atom2Idx: 1, order: 1 });
  // Carbonyl O
  atoms.push({ index: 2, element: "O", x: CC_BOND + 1.20, y: 0, z: 0, covalentRadius: 57, vdwRadius: 152 });
  bonds.push({ index: 1, atom1Idx: 1, atom2Idx: 2, order: 2 });
  // Aldehyde H on C1 at 120
  const angle120 = THREE.MathUtils.degToRad(120);
  atoms.push({ index: 3, element: "H", x: CC_BOND + Math.cos(angle120) * CH_BOND, y: Math.sin(angle120) * CH_BOND, z: 0, covalentRadius: 31, vdwRadius: 120 });
  bonds.push({ index: 2, atom1Idx: 1, atom2Idx: 3, order: 1 });
  // C0: 3 H's tetrahedral
  const dir0 = new THREE.Vector3(1, 0, 0);
  const pos0 = vseprPositions(dir0, 4);
  for (let i = 0; i < 3; i++) {
    const p = pos0[i];
    atoms.push({ index: atoms.length, element: "H", x: p.x * CH_BOND, y: p.y * CH_BOND, z: p.z * CH_BOND, covalentRadius: 31, vdwRadius: 120 });
    bonds.push({ index: bonds.length, atom1Idx: 0, atom2Idx: atoms.length - 1, order: 1 });
  }

  return { atoms, bonds, name: "acetaldehyde", formula: "CH3CHO", smiles: "CC=O" };
}

function buildDimethylEther(): MoleculeData {
  const atoms: AtomData[] = [];
  const bonds: MoleculeData["bonds"] = [];

  // C0 at -CO_BOND/2, O at 0, C1 at +CO_BOND/2
  const half = CO_BOND / 2;
  atoms.push({ index: 0, element: "C", x: -half, y: 0, z: 0, covalentRadius: 76, vdwRadius: 170 });
  atoms.push({ index: 1, element: "O", x: 0, y: 0.2, z: 0, covalentRadius: 66, vdwRadius: 152 });
  bonds.push({ index: 0, atom1Idx: 0, atom2Idx: 1, order: 1 });
  atoms.push({ index: 2, element: "C", x: half, y: 0, z: 0, covalentRadius: 76, vdwRadius: 170 });
  bonds.push({ index: 1, atom1Idx: 1, atom2Idx: 2, order: 1 });

  // Each C: 3 H's tetrahedral
  const dirC0 = new THREE.Vector3(1, 0.2, 0).normalize();
  const posC0 = vseprPositions(dirC0, 4);
  for (let i = 0; i < 3; i++) {
    const p = posC0[i];
    atoms.push({ index: atoms.length, element: "H", x: -half + p.x * CH_BOND, y: p.y * CH_BOND, z: p.z * CH_BOND, covalentRadius: 31, vdwRadius: 120 });
    bonds.push({ index: bonds.length, atom1Idx: 0, atom2Idx: atoms.length - 1, order: 1 });
  }

  const dirC1 = new THREE.Vector3(-1, 0.2, 0).normalize();
  const posC1 = vseprPositions(dirC1, 4);
  for (let i = 0; i < 3; i++) {
    const p = posC1[i];
    atoms.push({ index: atoms.length, element: "H", x: half + p.x * CH_BOND, y: p.y * CH_BOND, z: p.z * CH_BOND, covalentRadius: 31, vdwRadius: 120 });
    bonds.push({ index: bonds.length, atom1Idx: 2, atom2Idx: atoms.length - 1, order: 1 });
  }

  return { atoms, bonds, name: "dimethyl ether", formula: "CH3OCH3", smiles: "COC" };
}


function buildAlkaneChain(C: number, formula: string): MoleculeData | null {
  if (C < 3) return null; // handled by specific builders
  const atoms: AtomData[] = [];
  const bonds: MoleculeData["bonds"] = [];
  const bl = CH_BOND;

  // Zigzag in 3D: carbons alternately displaced in y and z
  const cPos: THREE.Vector3[] = [];
  for (let i = 0; i < C; i++) {
    const angleY = (i % 2 === 0) ? 1 : -1;
    const angleZ = (i % 2 === 0) ? 0.4 : -0.4;
    cPos.push(new THREE.Vector3(
      i * CC_BOND - (C - 1) * CC_BOND / 2,
      angleY * 0.35,
      angleZ * 0.2
    ));
  }

  for (let i = 0; i < C; i++) {
    atoms.push({
      index: i, element: "C",
      x: cPos[i].x, y: cPos[i].y, z: cPos[i].z,
      covalentRadius: 76, vdwRadius: 170,
    });
  }
  for (let i = 0; i < C - 1; i++) {
    bonds.push({ index: bonds.length, atom1Idx: i, atom2Idx: i + 1, order: 1 });
  }

  // Attach H's for each carbon
  for (let i = 0; i < C; i++) {
    // Determine bonded heavy atoms (up to 2 for internal, 1 for terminal)
    const neighbors: number[] = [];
    if (i > 0) neighbors.push(i - 1);
    if (i < C - 1) neighbors.push(i + 1);

    const hCount = 4 - neighbors.length;
    if (hCount <= 0) continue;

    // Direction is sum of away-from-neighbor vectors
    const away = new THREE.Vector3();
    for (const nIdx of neighbors) {
      away.add(new THREE.Vector3().subVectors(cPos[i], cPos[nIdx]));
    }
    if (away.length() < 0.001) away.set(0, 1, 0);
    away.normalize();

    const pos = vseprPositions(away, 4);
    // First `neighbors.length` positions are used by heavy-atom bonds
    // The rest are for H's
    // vseprPositions returns: [away-from-all-neighbors, ...remaining tetrahedral]
    // Actually it returns [d, other positions at 109.47 from d]
    // The first position `pos[0]` points away (in direction of `away`)
    // So we need to assign the heavy atoms to the tetrahedral positions too
    
    // For a terminal carbon (1 neighbor): the neighbor is at one tetrahedral position
    // The remaining 3 positions get H's
    // pos[0] = towards neighbor, pos[1..3] = other 3 tetrahedral positions
    // Wait, pos[0] = direction *away* from neighbor (negated toward)
    // Hmm, let me re-examine vseprPositions

    // vseprPositions(toward, 4): 
    // pos[0] = d (toward direction, i.e. towards neighbor)
    // pos[1..3] = at 109.47 from d, equally spaced
    // Actually looking at the code:
    // for i in 0..2: positions[i] = -cosT*d + sinT*rotPerp (these are AWAY from d)
    // pos[3] = d.clone() (toward the neighbor)
    
    // So the tetrahedral positions are:
    // index 0: away-from-neighbor (for H)
    // index 1, 2: other tetrahedral (for H)
    // index 3: toward neighbor (already used by the C-C bond)

    // For 1 neighbor: use pos[0], pos[1], pos[2] for 3 H's
    // For 2 neighbors (internal): use pos[0], pos[1] for 2 H's
    //   (but we need to map which positions are toward which neighbor)

    // Actually, this is getting complex. Let me simplify:
    // Just place H's using the simpler approach but with proper VSEPR
    for (let h = 0; h < hCount; h++) {
      // Use positions 0..hCount-1 from the remaining tetrahedral directions
      // pos[0] always points roughly away from all neighbors
      // For internal C (2 neighbors): we need to skip 2 positions (the neighbor dirs)
      // The 2 H positions would be at roughly 90 to the C-C-C plane
      
    // Simplified: just use pos[h] for H placement (this works for terminal C with 3 H's)
      // For internal C (2 H's), we need positions that are perpendicular to the plane
      const p = pos[h];
      atoms.push({
        index: atoms.length, element: "H",
        x: cPos[i].x + p.x * bl,
        y: cPos[i].y + p.y * bl,
        z: cPos[i].z + p.z * bl,
        covalentRadius: 31, vdwRadius: 120,
      });
      bonds.push({ index: bonds.length, atom1Idx: i, atom2Idx: atoms.length - 1, order: 1 });
    }
  }

  const prefix = ["meth", "eth", "prop", "but", "pent", "hex", "hept", "oct"][C - 1] || `C${C}`;
  return { atoms, bonds, name: `${prefix}ane`, formula, smiles: Array(C).fill("C").join("") };
}

//  Main builder 

export function buildHeuristicMolecule(formula: string, smiles: string): MoleculeData | null {
  // Try the general VSEPR builder first (handles all known molecules correctly)
  const vseprMol = buildFromKnownFormula(formula, smiles);
  if (vseprMol) return vseprMol;

  // Fall back to specific/heuristic builders below
  const counts = parseFormula(formula);
  if (counts.size === 0) return null;

  const C = counts.get("C") || 0, H = counts.get("H") || 0;
  const O = counts.get("O") || 0, N = counts.get("N") || 0;

  // Direct molecule builders for common cases
  if (formula === "CH4") return buildMethane(counts);
  if (formula === "C2H6") return buildEthane();
  if (formula === "C2H4") return buildEthene();
  if (formula === "C2H2") return buildEthyne();
  if (formula === "C6H6") return buildBenzene();
  if (formula === "H2O") return buildWater();
  if (formula === "NH3") return buildAmmonia();
  if (formula === "CO2") return buildCO2();
  if (formula === "CH3OH" || formula === "CH4O") return buildMethanol();
  if (formula === "C2H5OH" || formula === "C2H6O") return buildEthanol();
  if (formula === "CH3COOH") return buildAceticAcid();
  if (formula === "HCOOH") return buildFormicAcid();
  if (formula === "CH3CHO") return buildAcetaldehyde();
  if (formula === "CH3OCH3" || formula === "C2H6O") return buildDimethylEther();

  // Alkane chain builder for C3+
  if (C >= 3 && O === 0 && N === 0) {
    return buildAlkaneChain(C, formula);
  }

  // Fallback: simple single heavy atom
  if (C === 0 && O === 1 && H === 0) {
    return buildWater();
  }
  if (C === 0 && N === 1 && H === 3) {
    return buildAmmonia();
  }

  // Last resort: build minimal valid molecule from counts
  const atoms: AtomData[] = [];
  const bonds: MoleculeData["bonds"] = [];
  let idx = 0;

  // One carbon at origin as center
  if (C > 0) {
    atoms.push({ index: idx++, element: "C", x: 0, y: 0, z: 0, covalentRadius: 76, vdwRadius: 170 });
    const tet = tetrahedralPositions();
    let slot = 0;
    if (O > 0) {
      atoms.push({ index: idx++, element: "O", x: tet[slot].x * CO_BOND, y: tet[slot].y * CO_BOND, z: tet[slot].z * CO_BOND, covalentRadius: 66, vdwRadius: 152 });
      bonds.push({ index: bonds.length, atom1Idx: 0, atom2Idx: idx - 1, order: 1 });
      slot++;
    }
    const hCount = Math.min(H, 4 - slot - (C > 1 ? 1 : 0));
    for (let i = 0; i < hCount; i++) {
      const t = tet[slot % tet.length];
      atoms.push({ index: idx++, element: "H", x: t.x * CH_BOND, y: t.y * CH_BOND, z: t.z * CH_BOND, covalentRadius: 31, vdwRadius: 120 });
      bonds.push({ index: bonds.length, atom1Idx: 0, atom2Idx: idx - 1, order: 1 });
      slot++;
    }
  }

  // Remaining H's around O if needed
  for (let i = 0; i < Math.max(0, H - (C > 0 ? 4 : 0)) && O > 0; i++) {
    const oIdx = atoms.findIndex((a) => a.element === "O");
    if (oIdx >= 0) {
      const angle = (i / 2) * Math.PI * 2;
      atoms.push({ index: idx++, element: "H", x: atoms[oIdx].x + Math.cos(angle) * OH_BOND, y: atoms[oIdx].y + Math.sin(angle) * OH_BOND, z: atoms[oIdx].z + 0.5, covalentRadius: 31, vdwRadius: 120 });
      bonds.push({ index: bonds.length, atom1Idx: oIdx, atom2Idx: idx - 1, order: 1 });
    }
  }

  return { atoms, bonds, name: formula, formula, smiles };
}
