package com.chemviz3d.engine

import com.chemviz3d.model.*

object PropertyCalculator {
    fun calculate(atoms: List<AtomData>, bonds: List<BondData>): com.chemviz3d.model.MoleculeProperties {
        val mw = atoms.sumOf { GeometryEngine.atomicMass(it.element) }

        // logP: Wildman-Crippen approximation
        val logP = calcLogP(atoms)

        val hbd = atoms.count { it.element == "O" || it.element == "N" }
        val hba = countHBA(atoms, bonds)

        val rotatable = countRotatableBonds(bonds)

        val tpsa = calcTPSA(atoms)

        return MoleculeProperties(
            molecularWeight = mw,
            logP = logP,
            hBondDonors = hbd,
            hBondAcceptors = hba,
            rotatableBonds = rotatable,
            tpsa = tpsa
        )
    }

    private fun calcLogP(atoms: List<AtomData>): Double {
        // Simplified logP estimation
        val contributions = mapOf(
            "C" to 0.5, "H" to 0.0, "O" to -0.5, "N" to -0.8,
            "F" to 0.3, "Cl" to 0.7, "Br" to 0.9, "I" to 1.2,
            "S" to 0.4, "P" to 0.0
        )
        return atoms.sumOf { contributions[it.element] ?: 0.0 }
    }

    private fun countHBA(atoms: List<AtomData>, bonds: List<BondData>): Int {
        // HBA = O or N atoms, except those bonded to H (that's HBD)
        val adj = mutableMapOf<Int, MutableList<Int>>()
        for (b in bonds) {
            adj.getOrPut(b.atom1Idx) { mutableListOf() }.add(b.atom2Idx)
            adj.getOrPut(b.atom2Idx) { mutableListOf() }.add(b.atom1Idx)
        }
        var count = 0
        for (atom in atoms) {
            if (atom.element == "O" || atom.element == "N") {
                val neighbors = adj[atom.index] ?: continue
                val hasHBonds = neighbors.any { atoms[it].element == "H" }
                if (!hasHBonds) count++
            }
        }
        return count
    }

    private fun countRotatableBonds(bonds: List<BondData>): Int {
        return bonds.count { it.order == 1 }
    }

    private fun calcTPSA(atoms: List<AtomData>): Double {
        // Simplified TPSA from fragment contributions
        val contributions = mapOf(
            "O" to 20.0, "N" to 15.0, "F" to 5.0, "Cl" to 3.0, "Br" to 2.0, "I" to 1.0
        )
        return atoms.sumOf { contributions[it.element] ?: 0.0 }
    }
}
