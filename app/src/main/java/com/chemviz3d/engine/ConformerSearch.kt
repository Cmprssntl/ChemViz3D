package com.chemviz3d.engine

import com.chemviz3d.model.*
import kotlin.math.*

object ConformerSearch {

    private const val MONTE_CARLO_SAMPLES = 500

    fun searchExtreme(molecule: MoleculeData): ConformerSearchResult {
        val bonds = getRotatableBonds(molecule)
        val baseResult = CoplanarityDetector.countMaxPlanarAtoms(molecule)

        if (bonds.isEmpty()) {
            return ConformerSearchResult(
                mostPlanar = ConformerResult(cloneMol(molecule), baseResult.largestCount, baseResult.largestIndices, baseResult.allIndices),
                leastPlanar = ConformerResult(cloneMol(molecule), baseResult.largestCount, baseResult.largestIndices, baseResult.allIndices),
                totalSearched = 1
            )
        }

        // Phase 1: Coarse scan (15° steps, 24 angles)
        val COARSE_STEPS = 24
        val coarseAngle = 360f / COARSE_STEPS

        var bestMostAngles = FloatArray(bonds.size) { 0f }
        var bestMostScore = CoplanarityDetector.scoreCoplanarity(molecule)
        var bestLeastAngles = FloatArray(bonds.size) { 0f }
        var bestLeastScore = bestMostScore
        var totalSearched = 1

        if (bonds.size <= 3) {
            // Full enumeration at coarse resolution
            val angleCache = mutableListOf<FloatArray>()
            fun generate(idx: Int, current: FloatArray) {
                if (idx == bonds.size) {
                    angleCache.add(current.copyOf())
                    return
                }
                for (s in 0 until COARSE_STEPS) {
                    current[idx] = s * coarseAngle
                    generate(idx + 1, current)
                }
            }
            if (bonds.isNotEmpty()) generate(0, FloatArray(bonds.size))

            for (angles in angleCache) {
                val rotated = applyRotations(molecule, bonds, angles)
                val score = CoplanarityDetector.scoreCoplanarity(rotated)
                totalSearched++
                if (isBetter(score, bestMostScore, "most")) {
                    bestMostScore = score
                    bestMostAngles = angles.copyOf()
                }
                if (isBetter(score, bestLeastScore, "least")) {
                    bestLeastScore = score
                    bestLeastAngles = angles.copyOf()
                }
            }
        } else {
            // Monte Carlo for >3 bonds
            for (i in 0 until MONTE_CARLO_SAMPLES) {
                val angles = FloatArray(bonds.size) { (0 until COARSE_STEPS).random() * coarseAngle }
                val rotated = applyRotations(molecule, bonds, angles)
                val score = CoplanarityDetector.scoreCoplanarity(rotated)
                totalSearched++
                if (isBetter(score, bestMostScore, "most")) {
                    bestMostScore = score
                    bestMostAngles = angles.copyOf()
                }
                if (isBetter(score, bestLeastScore, "least")) {
                    bestLeastScore = score
                    bestLeastAngles = angles.copyOf()
                }
            }
        }

        // Phase 2: Local refinement (0.5° step, ±5° window)
        if (bonds.size <= 3) {
            val refinedMost = refineAngles(molecule, bonds, bestMostAngles, "most")
            if (isBetter(refinedMost.score, bestMostScore, "most")) {
                bestMostScore = refinedMost.score
                bestMostAngles = refinedMost.angles
            }
            val refinedLeast = refineAngles(molecule, bonds, bestLeastAngles, "least")
            if (isBetter(refinedLeast.score, bestLeastScore, "least")) {
                bestLeastScore = refinedLeast.score
                bestLeastAngles = refinedLeast.angles
            }
        }

        val mostMol = applyRotations(molecule, bonds, bestMostAngles)
        val leastMol = applyRotations(molecule, bonds, bestLeastAngles)
        val mostResult = CoplanarityDetector.countMaxPlanarAtoms(mostMol)
        val leastResult = CoplanarityDetector.countMaxPlanarAtoms(leastMol)

        return ConformerSearchResult(
            mostPlanar = ConformerResult(mostMol, mostResult.largestCount, mostResult.largestIndices, mostResult.allIndices),
            leastPlanar = ConformerResult(leastMol, leastResult.largestCount, leastResult.largestIndices, leastResult.allIndices),
            totalSearched = totalSearched
        )
    }

    // ── Helpers ──

    private fun getRotatableBonds(mol: MoleculeData): List<BondData> {
        val adj = buildSimpleAdj(mol.bonds)
        val ringBonds = findRingBonds(adj, mol.bonds)
        return mol.bonds.filter { b ->
            if (b.order != 1) return@filter false
            val key = minOf(b.atom1Idx, b.atom2Idx).toString() + "," + maxOf(b.atom1Idx, b.atom2Idx)
            if (key in ringBonds) return@filter false
            val a1 = mol.atoms.getOrNull(b.atom1Idx) ?: return@filter false
            val a2 = mol.atoms.getOrNull(b.atom2Idx) ?: return@filter false
            if (a1.element == "H" || a2.element == "H") return@filter false
            (a1.element == "C" && a2.element == "C") ||
            (a1.element == "C" && a2.element == "O") ||
            (a1.element == "O" && a2.element == "C")
        }
    }

    private fun cloneMol(mol: MoleculeData): MoleculeData {
        return MoleculeData(
            formula = mol.formula,
            name = mol.name,
            smiles = mol.smiles,
            atoms = mol.atoms.map { it.copy() }.toMutableList(),
            bonds = mol.bonds.map { it.copy() }.toMutableList()
        )
    }

    private fun applyRotations(mol: MoleculeData, bonds: List<BondData>, angles: FloatArray): MoleculeData {
        var cur = cloneMol(mol)
        for (i in bonds.indices) {
            if (abs(angles[i]) > 0.5f) {
                cur = BondRotator.applyRotation(cur, bonds[i].atom1Idx, bonds[i].atom2Idx, angles[i])
            }
        }
        return cur
    }

    private fun refineAngles(
        molecule: MoleculeData,
        bonds: List<BondData>,
        startAngles: FloatArray,
        mode: String
    ): RefineResult {
        val FINE_RANGE = 5f
        val FINE_STEPS = 21
        val step = 2f * FINE_RANGE / (FINE_STEPS - 1)

        var angles = startAngles.copyOf()
        var bestScore = CoplanarityDetector.scoreCoplanarity(applyRotations(molecule, bonds, angles))

        for (iter in 0 until 5) {
            var improved = false
            for (b in bonds.indices) {
                var localBest = angles[b]
                val trialBase = angles.copyOf()
                for (s in 0 until FINE_STEPS) {
                    val offset = -FINE_RANGE + s * step
                    trialBase[b] = angles[b] + offset
                    // Normalize angle to 0-360
                    trialBase[b] = ((trialBase[b] % 360f) + 360f) % 360f
                    val rotated = applyRotations(molecule, bonds, trialBase)
                    val score = CoplanarityDetector.scoreCoplanarity(rotated)
                    if (isBetter(score, bestScore, mode)) {
                        bestScore = score
                        localBest = trialBase[b]
                        improved = true
                    }
                }
                angles[b] = localBest
            }
            if (!improved) break
        }
        return RefineResult(angles, bestScore)
    }

    private fun isBetter(a: CoplanarityDetector.ScoreResult, b: CoplanarityDetector.ScoreResult, mode: String): Boolean {
        return if (mode == "most") {
            if (a.count != b.count) a.count > b.count else a.dev < b.dev
        } else {
            if (a.count != b.count) a.count < b.count else a.dev > b.dev
        }
    }

    private fun buildSimpleAdj(bonds: List<BondData>): Map<Int, List<Int>> {
        val adj = mutableMapOf<Int, MutableList<Int>>()
        for (b in bonds) {
            adj.getOrPut(b.atom1Idx) { mutableListOf() }.add(b.atom2Idx)
            adj.getOrPut(b.atom2Idx) { mutableListOf() }.add(b.atom1Idx)
        }
        return adj
    }

    private fun findRingBonds(adj: Map<Int, List<Int>>, bonds: List<BondData>): Set<String> {
        val rings = mutableListOf<List<Int>>()
        val visited = mutableSetOf<Int>()
        val maxSize = 8

        fun dfs(start: Int, current: Int, path: MutableList<Int>) {
            visited.add(current)
            val neighbors = adj[current] ?: emptyList()
            for (next in neighbors) {
                if (next == start && path.size >= 3 && path.size <= maxSize) {
                    val norm = path.toList()
                    val minIdx = norm.indexOf(norm.min())
                    val normalized = norm.drop(minIdx) + norm.take(minIdx)
                    val key = normalized.joinToString(",")
                    if (rings.none { it.joinToString(",") == key }) rings.add(normalized)
                } else if (next !in visited && path.size < maxSize && next > start) {
                    path.add(next)
                    dfs(start, next, path)
                    path.removeAt(path.lastIndex)
                }
            }
            visited.remove(current)
        }

        for (node in adj.keys.sorted()) {
            if (rings.none { it.contains(node) }) {
                visited.clear()
                dfs(node, node, mutableListOf(node))
            }
        }

        val ringBonds = mutableSetOf<String>()
        for (ring in rings) {
            for (i in ring.indices) {
                val a = minOf(ring[i], ring[(i + 1) % ring.size])
                val b = maxOf(ring[i], ring[(i + 1) % ring.size])
                ringBonds.add("$a,$b")
            }
        }
        return ringBonds
    }

    data class RefineResult(val angles: FloatArray, val score: CoplanarityDetector.ScoreResult)
}
