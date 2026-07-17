package com.chemviz3d.model

// ── Core data types ──

data class AtomData(
    val index: Int,
    val element: String,
    var x: Float = 0f,
    var y: Float = 0f,
    var z: Float = 0f,
    val hybridization: String? = null,
    val charge: Int? = null,
    val mass: Double? = null,
    val implicitH: Int = 0
)

data class BondData(
    val index: Int,
    val atom1Idx: Int,
    val atom2Idx: Int,
    val order: Int = 1
)

data class MoleculeData(
    val formula: String,
    val name: String,
    val smiles: String,
    val atoms: MutableList<AtomData>,
    val bonds: MutableList<BondData>
)

data class ConformerResult(
    val molecule: MoleculeData,
    val coplanarAtomCount: Int,
    val coplanarAtomIndices: List<Int>,
    val allCoplanarIndices: List<Int>
)

data class ConformerSearchResult(
    val mostPlanar: ConformerResult,
    val leastPlanar: ConformerResult,
    val totalSearched: Int
)

data class ConformerStats(
    val possible: Int,
    val definite: Int
)

data class MoleculeProperties(
    val molecularWeight: Double,
    val logP: Double,
    val hBondDonors: Int,
    val hBondAcceptors: Int,
    val rotatableBonds: Int,
    val tpsa: Double
)

data class PlanarFragment(
    val atomIndices: List<Int>,
    val type: String,  // "ring", "alkene", "carbonyl", "chain", "other"
    val normalX: Float,
    val normalY: Float,
    val normalZ: Float,
    val centerX: Float,
    val centerY: Float,
    val centerZ: Float
)
