package com.chemviz3d.engine

import com.chemviz3d.model.*
import kotlin.math.*

object BondRotator {

    fun applyRotation(molecule: MoleculeData, atom1Idx: Int, atom2Idx: Int, angleDeg: Float): MoleculeData {
        if (abs(angleDeg) < 0.5f) return molecule

        val adj = buildWeightedAdj(molecule.bonds)

        // BFS from atom1 without crossing atom2
        fun bfs(start: Int, blocked: Int): Set<Int> {
            val visited = mutableSetOf<Int>()
            val queue = ArrayDeque<Int>()
            visited.add(start)
            queue.add(start)
            while (queue.isNotEmpty()) {
                val current = queue.removeFirst()
                val neighbors = adj[current] ?: continue
                for (neighbor in neighbors) {
                    if (neighbor == blocked) continue
                    if (neighbor !in visited) {
                        visited.add(neighbor)
                        queue.add(neighbor)
                    }
                }
            }
            return visited
        }

        val sideA = bfs(atom1Idx, atom2Idx)
        val sideB = bfs(atom2Idx, atom1Idx)

        val (anchorIdx, rotateIdx, rotatingSet) = if (sideA.size <= sideB.size) {
            Triple(atom2Idx, atom1Idx, sideA)
        } else {
            Triple(atom1Idx, atom2Idx, sideB)
        }

        val rotatingMinusAnchor = rotatingSet - anchorIdx - rotateIdx
        if (rotatingMinusAnchor.isEmpty()) return molecule

        val anchor = molecule.atoms[anchorIdx]
        val rotateAtom = molecule.atoms[rotateIdx]
        val axis = Vec3(
            anchor.x - rotateAtom.x,
            anchor.y - rotateAtom.y,
            anchor.z - rotateAtom.z
        ).normalize()

        val newAtoms = molecule.atoms.map { it.copy() }.toMutableList()
        for (idx in rotatingMinusAnchor) {
            val atom = newAtoms[idx]
            val rel = Vec3(atom.x - rotateAtom.x, atom.y - rotateAtom.y, atom.z - rotateAtom.z)
            val rotated = rel.rotate(axis, angleDeg)
            newAtoms[idx] = atom.copy(
                x = rotateAtom.x + rotated.x,
                y = rotateAtom.y + rotated.y,
                z = rotateAtom.z + rotated.z
            )
        }

        return molecule.copy(atoms = newAtoms)
    }

    private fun buildWeightedAdj(bonds: List<BondData>): Map<Int, List<Int>> {
        val adj = mutableMapOf<Int, MutableList<Int>>()
        for (b in bonds) {
            adj.getOrPut(b.atom1Idx) { mutableListOf() }.add(b.atom2Idx)
            adj.getOrPut(b.atom2Idx) { mutableListOf() }.add(b.atom1Idx)
        }
        return adj
    }
}
