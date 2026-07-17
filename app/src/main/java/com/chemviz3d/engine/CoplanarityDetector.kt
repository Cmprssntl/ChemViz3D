package com.chemviz3d.engine

import com.chemviz3d.model.*
import kotlin.math.*

object CoplanarityDetector {

    private const val DIHEDRAL_THRESHOLD = 15.0    // degrees
    private const val PLANE_DEVIATION = 0.5        // Angstroms
    private const val ANGLE_MERGE_THRESH = 30.0    // degrees

    fun detectFragments(mol: MoleculeData): List<PlanarFragment> {
        val results = mutableListOf<PlanarFragment>()
        val adj = buildAdj(mol.bonds)
        val atoms = mol.atoms

        // 1. Rings
        val rings = findRings(adj)
        for (ring in rings) {
            val positions = ring.map { idx -> Vec3(atoms[idx].x, atoms[idx].y, atoms[idx].z) }
            if (positions.size < 3) continue
            val (normal, center) = bestFitPlane(positions)
            val dev = planarityDeviation(positions, normal, center)
            if (dev < PLANE_DEVIATION) {
                results.add(PlanarFragment(
                    atomIndices = ring,
                    type = if (ring.size == 6) "ring" else "other",
                    normalX = normal.x, normalY = normal.y, normalZ = normal.z,
                    centerX = center.x, centerY = center.y, centerZ = center.z
                ))
            }
        }

        // 2. C=C alkene
        for (bond in mol.bonds) {
            if (bond.order != 2) continue
            val a1 = atoms[bond.atom1Idx]
            val a2 = atoms[bond.atom2Idx]
            if (a1.element != "C" || a2.element != "C") continue
            val subs1 = (adj[bond.atom1Idx] ?: emptyList()).filter { it != bond.atom2Idx }
            val subs2 = (adj[bond.atom2Idx] ?: emptyList()).filter { it != bond.atom1Idx }
            val allIdx = listOf(bond.atom1Idx, bond.atom2Idx) + subs1 + subs2
            val positions = allIdx.map { Vec3(atoms[it].x, atoms[it].y, atoms[it].z) }
            if (positions.size >= 3) {
                val (normal, center) = bestFitPlane(positions)
                if (planarityDeviation(positions, normal, center) < PLANE_DEVIATION) {
                    results.add(PlanarFragment(allIdx, "alkene", normal.x, normal.y, normal.z, center.x, center.y, center.z))
                }
            }
        }

        // 3. C=O carbonyl
        for (bond in mol.bonds) {
            if (bond.order != 2) continue
            val a1 = atoms[bond.atom1Idx]
            val a2 = atoms[bond.atom2Idx]
            val cIdx = if (a1.element == "C") bond.atom1Idx else if (a2.element == "C") bond.atom2Idx else -1
            val oIdx = if (a1.element == "O") bond.atom1Idx else if (a2.element == "O") bond.atom2Idx else -1
            if (cIdx < 0 || oIdx < 0) continue
            val cNeighbors = (adj[cIdx] ?: emptyList())
            val planarSet = listOf(cIdx) + cNeighbors.filter { it != oIdx } + oIdx
            val positions = planarSet.map { Vec3(atoms[it].x, atoms[it].y, atoms[it].z) }
            if (positions.size >= 3) {
                val (normal, center) = bestFitPlane(positions)
                if (planarityDeviation(positions, normal, center) < PLANE_DEVIATION) {
                    results.add(PlanarFragment(planarSet, "carbonyl", normal.x, normal.y, normal.z, center.x, center.y, center.z))
                }
            }
        }

        // 4. Planar 4-atom chains
        results.addAll(detectPlanarChains(atoms, mol.bonds, adj))

        // Remove duplicates
        val seen = mutableSetOf<String>()
        return results.filter { r ->
            val key = r.atomIndices.sorted().joinToString(",")
            seen.add(key)
        }
    }

    fun countMaxPlanarAtoms(mol: MoleculeData): PlanarCountResult {
        val fragments = detectFragments(mol)
        // Merge overlapping fragments with similar normals
        val merged = mutableListOf<MutableSet<Int>>()
        val mergedNorms = mutableListOf<Vec3>()

        for (f in fragments) {
            val fNorm = Vec3(f.normalX, f.normalY, f.normalZ).normalize()
            val fIndices = f.atomIndices.toSet()
            var added = false
            for (g in merged.indices) {
                val overlaps = merged[g].any { it in fIndices }
                if (overlaps) {
                    val angle = mergedNorms[g].angleBetween(fNorm)
                    if (angle * 180.0 / PI < ANGLE_MERGE_THRESH) {
                        merged[g].addAll(fIndices)
                        added = true
                        break
                    }
                }
            }
            if (!added) {
                merged.add(fIndices.toMutableSet())
                mergedNorms.add(fNorm)
            }
        }

        var bestCount = 0
        var bestIndices = listOf<Int>()
        val allAtoms = mutableSetOf<Int>()
        for (set in merged) {
            allAtoms.addAll(set)
            if (set.size > bestCount) {
                bestCount = set.size
                bestIndices = set.toList()
            }
        }

        // Geometric floor
        if (bestCount < 3 && mol.atoms.size >= 3) {
            bestCount = 3
            bestIndices = listOf(0, 1, 2)
        }

        return PlanarCountResult(bestCount, bestIndices, allAtoms.toList())
    }

    fun scoreCoplanarity(mol: MoleculeData): ScoreResult {
        val result = countMaxPlanarAtoms(mol)
        if (result.largestCount < 3) return ScoreResult(result.largestCount, 0f)
        val positions = result.largestIndices.map {
            Vec3(mol.atoms[it].x, mol.atoms[it].y, mol.atoms[it].z)
        }
        val (normal, center) = bestFitPlane(positions)
        var maxDev = 0f
        for (p in positions) {
            val d = abs((p.minus(center)).dot(normal))
            if (d > maxDev) maxDev = d
        }
        return ScoreResult(result.largestCount, maxDev)
    }

    // ── Internal helpers ──

    private fun buildAdj(bonds: List<BondData>): Map<Int, List<Int>> {
        val adj = mutableMapOf<Int, MutableList<Int>>()
        for (b in bonds) {
            adj.getOrPut(b.atom1Idx) { mutableListOf() }.add(b.atom2Idx)
            adj.getOrPut(b.atom2Idx) { mutableListOf() }.add(b.atom1Idx)
        }
        return adj
    }

    private fun findRings(adj: Map<Int, List<Int>>, maxSize: Int = 8): List<List<Int>> {
        val rings = mutableListOf<List<Int>>()
        val visited = mutableSetOf<Int>()

        fun dfs(start: Int, current: Int, path: MutableList<Int>) {
            visited.add(current)
            val neighbors = adj[current] ?: emptyList()
            for (next in neighbors) {
                if (next == start && path.size >= 3 && path.size <= maxSize) {
                    val ring = path.toList()
                    val minIdx = ring.indexOf(ring.min())
                    val normalized = ring.drop(minIdx) + ring.take(minIdx)
                    val key = normalized.joinToString(",")
                    if (rings.none { it.joinToString(",") == key }) {
                        rings.add(normalized)
                    }
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
        return rings
    }

    private fun bestFitPlane(positions: List<Vec3>): Pair<Vec3, Vec3> {
        val n = positions.size
        if (n < 3) return Pair(Vec3(0f, 0f, 1f), Vec3(0f, 0f, 0f))

        val center = Vec3(
            positions.sumOf { it.x.toDouble() }.toFloat() / n,
            positions.sumOf { it.y.toDouble() }.toFloat() / n,
            positions.sumOf { it.z.toDouble() }.toFloat() / n
        )

        var xx = 0f; var xy = 0f; var xz = 0f
        var yy = 0f; var yz = 0f; var zz = 0f
        for (p in positions) {
            val dx = p.x - center.x; val dy = p.y - center.y; val dz = p.z - center.z
            xx += dx * dx; xy += dx * dy; xz += dx * dz
            yy += dy * dy; yz += dy * dz
            zz += dz * dz
        }

        val v1 = Vec3(xx, xy, xz)
        val v2 = Vec3(xy, yy, yz)
        val EPS = 0.0001f

        if (v1.length() < EPS) return Pair(Vec3(1f, 0f, 0f), center)
        if (v2.length() < EPS) return Pair(Vec3(0f, 1f, 0f), center)

        val normal = v1.cross(v2).normalize()
        return Pair(normal, center)
    }

    private fun planarityDeviation(positions: List<Vec3>, normal: Vec3, center: Vec3): Float {
        var maxDist = 0f
        for (p in positions) {
            val d = abs((p.minus(center)).dot(normal))
            if (d > maxDist) maxDist = d
        }
        return maxDist
    }

    private fun detectPlanarChains(atoms: List<AtomData>, bonds: List<BondData>, adj: Map<Int, List<Int>>): List<PlanarFragment> {
        val results = mutableListOf<PlanarFragment>()
        val visited = mutableSetOf<String>()

        for (b in bonds) {
            val a = b.atom1Idx; val c = b.atom2Idx
            val aNbrs = adj[a] ?: emptyList()
            val cNbrs = adj[c] ?: emptyList()
            for (a2 in aNbrs) {
                if (a2 == c) continue
                for (c2 in cNbrs) {
                    if (c2 == a || c2 == a2) continue
                    val p1 = Vec3(atoms[a2].x, atoms[a2].y, atoms[a2].z)
                    val p2 = Vec3(atoms[a].x, atoms[a].y, atoms[a].z)
                    val p3 = Vec3(atoms[c].x, atoms[c].y, atoms[c].z)
                    val p4 = Vec3(atoms[c2].x, atoms[c2].y, atoms[c2].z)
                    val dihedral = dihedralAngle(p1, p2, p3, p4)
                    val planarity = min(dihedral, 180.0 - dihedral)
                    if (planarity < DIHEDRAL_THRESHOLD) {
                        val indices = listOf(a2, a, c, c2).sorted()
                        val key = indices.joinToString(",")
                        if (visited.add(key)) {
                            val pos = indices.map { Vec3(atoms[it].x, atoms[it].y, atoms[it].z) }
                            val (normal, center) = bestFitPlane(pos)
                            results.add(PlanarFragment(indices, "chain", normal.x, normal.y, normal.z, center.x, center.y, center.z))
                        }
                    }
                }
            }
        }
        return results
    }

    private fun dihedralAngle(p1: Vec3, p2: Vec3, p3: Vec3, p4: Vec3): Double {
        val v1 = p2.minus(p1)
        val v2 = p3.minus(p2)
        val v3 = p4.minus(p3)
        val n1 = v1.cross(v2)
        val n2 = v2.cross(v3)
        if (n1.length() < 0.0001f || n2.length() < 0.0001f) return 0.0
        val cosA = (n1.dot(n2) / (n1.length() * n2.length())).toDouble().coerceIn(-1.0, 1.0)
        return Math.toDegrees(acos(cosA))
    }

    data class PlanarCountResult(
        val largestCount: Int,
        val largestIndices: List<Int>,
        val allIndices: List<Int>
    )

    data class ScoreResult(
        val count: Int,
        val dev: Float      // max deviation in Angstroms
    )
}
