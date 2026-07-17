package com.chemviz3d.engine

import com.chemviz3d.model.*
import kotlin.math.*

typealias Hybrid = String // "sp", "sp2", "sp3"

// ── Faithful port of the web vseprBuilder.ts ──

object VseprBuilder {

    // Bond lengths (Angstroms)
    private const val BL_CC = 1.54f; private const val BL_CC2 = 1.34f; private const val BL_CC3 = 1.20f
    private const val BL_CH = 1.09f; private const val BL_CO = 1.43f; private const val BL_CO2 = 1.20f
    private const val BL_CN = 1.47f; private const val BL_OH = 0.96f; private const val BL_NH = 1.01f

    private const val TET_DEG = 109.471
    private val TET_RAD = Math.toRadians(TET_DEG)

    /** maps canonical formula → { atoms[], bonds[] } */
    private data class BondSpec(
        val atoms: List<String>,
        val bonds: List<Triple<Int, Int, Int>> // (idx1, idx2, order)
    )

    private val KNOWN_SPECS = mapOf<String, BondSpec>(
        // Hydrocarbons
        "CH4" to BondSpec(listOf("C"), emptyList()),
        "C2H6" to BondSpec(listOf("C", "C"), listOf(Triple(0, 1, 1))),
        "C2H4" to BondSpec(listOf("C", "C"), listOf(Triple(0, 1, 2))),
        "C2H2" to BondSpec(listOf("C", "C"), listOf(Triple(0, 1, 3))),
        "C3H8" to BondSpec(listOf("C", "C", "C"), listOf(Triple(0, 1, 1), Triple(1, 2, 1))),
        "C4H10" to BondSpec(listOf("C", "C", "C", "C"),
            listOf(Triple(0, 1, 1), Triple(1, 2, 1), Triple(2, 3, 1))),
        "C5H12" to BondSpec(listOf("C", "C", "C", "C", "C"),
            listOf(Triple(0, 1, 1), Triple(0, 2, 1), Triple(0, 3, 1), Triple(0, 4, 1))),

        // Alcohols & ethers
        "CH4O" to BondSpec(listOf("C", "O"), listOf(Triple(0, 1, 1))),
        "C2H6O" to BondSpec(listOf("C", "C", "O"), listOf(Triple(0, 1, 1), Triple(1, 2, 1))),
        "C2H6O2" to BondSpec(listOf("C", "O", "C"), listOf(Triple(0, 1, 1), Triple(1, 2, 1))),

        // Carbonyl compounds
        "C2H4O" to BondSpec(listOf("C", "C", "O"), listOf(Triple(0, 1, 1), Triple(1, 2, 2))),
        "CH2O2" to BondSpec(listOf("C", "O", "O"), listOf(Triple(0, 1, 2), Triple(0, 2, 1))),
        "C2H4O2" to BondSpec(listOf("C", "C", "O", "O"), listOf(Triple(0, 1, 1), Triple(1, 2, 2), Triple(1, 3, 1))),

        // Esters
        "C3H6O2" to BondSpec(listOf("C", "C", "O", "O", "C"),
            listOf(Triple(0, 1, 1), Triple(1, 2, 2), Triple(1, 3, 1), Triple(3, 4, 1))),
        "C4H8O2" to BondSpec(listOf("C", "C", "C", "O", "O", "C"),
            listOf(Triple(0, 1, 1), Triple(1, 2, 1), Triple(2, 3, 2), Triple(2, 4, 1), Triple(4, 5, 1))),

        // Inorganic
        "H2O" to BondSpec(listOf("O"), emptyList()),
        "NH3" to BondSpec(listOf("N"), emptyList()),
        "CO2" to BondSpec(listOf("C", "O", "O"), listOf(Triple(0, 1, 2), Triple(0, 2, 2))),

        // Amines
        "CH5N" to BondSpec(listOf("C", "N"), listOf(Triple(0, 1, 1))),
        "C2H7N" to BondSpec(listOf("C", "C", "N"), listOf(Triple(0, 1, 1), Triple(1, 2, 1))),

        // Aromatics
        "C6H6" to BondSpec(listOf("C", "C", "C", "C", "C", "C"),
            listOf(Triple(0, 1, 1), Triple(1, 2, 1), Triple(2, 3, 1),
                Triple(3, 4, 1), Triple(4, 5, 1), Triple(5, 0, 1)))
    )

    private val NAME_MAP = mapOf(
        "CH4" to "methane", "C2H6" to "ethane", "C2H4" to "ethene", "C2H2" to "ethyne",
        "C6H6" to "benzene", "C3H8" to "propane", "C4H10" to "butane",
        "C3H6O2" to "methyl acetate", "C4H8O2" to "ethyl acetate",
        "CH4O" to "methanol", "C2H6O" to "ethanol", "C2H4O2" to "acetic acid",
        "CH2O2" to "formic acid", "C2H4O" to "acetaldehyde", "C2H6O2" to "dimethyl ether",
        "H2O" to "water", "NH3" to "ammonia", "CO2" to "carbon dioxide",
        "CH5N" to "methylamine", "C2H7N" to "ethylamine"
    )

    /** Normalize user input like "C2H5OH" → canonical "C2H6O" */
    private val NORM_MAP = mapOf(
        "CH3OH" to "CH4O", "C2H5OH" to "C2H6O",
        "CH3COOH" to "C2H4O2", "HCOOH" to "CH2O2",
        "CH3CHO" to "C2H4O", "CH3OCH3" to "C2H6O2",
        "CH3CCH33" to "C5H12", "C5H12" to "C5H12",
        "CH3CH2CH3" to "C3H8", "CH3CH2CH2CH3" to "C4H10",
        "CH3NH2" to "CH5N", "C2H5NH2" to "C2H7N",
        "CH3CH2NH2" to "C2H7N"
    )

    // ── public API ──

    fun buildFromFormula(formula: String): MoleculeData? {
        val counts = FormulaParser.parse(formula)
        if (counts.isEmpty()) return null
        val canonical = FormulaParser.formulaToCanonical(counts)
        val key = NORM_MAP[formula] ?: NORM_MAP[canonical] ?: canonical
        val spec = KNOWN_SPECS[key] ?: return null
        return buildFromBondSpec(spec, formula, key)
    }

    // ── core builder (matches buildFromBondSpec in vseprBuilder.ts) ──

    private fun buildFromBondSpec(spec: BondSpec, formula: String, key: String): MoleculeData {
        val n = spec.atoms.size
        if (n == 0) return MoleculeData(formula, formula, "", mutableListOf(), mutableListOf())

        // 1) Hybridisation per atom
        val hyb = spec.atoms.mapIndexed { i, el -> getHybrid(el, spec, i) }

        // 2) Place atoms via BFS
        val pos = Array(n) { FloatArray(3) }
        val placed = BooleanArray(n)
        val occupied = Array(n) { mutableSetOf<Int>() }

        // Seed = atom with highest degree
        var seed = 0
        var maxDeg = -1
        for (i in 0 until n) {
            val deg = spec.bonds.count { b -> b.first == i || b.second == i }
            if (deg > maxDeg) { maxDeg = deg; seed = i }
        }

        placed[seed] = true
        pos[seed][0] = 0f; pos[seed][1] = 0f; pos[seed][2] = 0f

        // Place the first bond partner at (bl, 0, 0)
        val seedBonds = spec.bonds.filter { b -> b.first == seed || b.second == seed }
        if (seedBonds.isNotEmpty() && n > 1) {
            val firstBond = seedBonds[0]
            val firstNbr = if (firstBond.first == seed) firstBond.second else firstBond.first
            val bl = bondLen(spec.atoms[seed], spec.atoms[firstNbr], firstBond.third)
            pos[firstNbr][0] = bl; pos[firstNbr][1] = 0f; pos[firstNbr][2] = 0f
            placed[firstNbr] = true

            // Seed's VSEPR slot: the last slot is used by the neighbor
            val seedDirs = vseprPositions(floatTriple(1f, 0f, 0f), nSubstituents(spec.atoms[seed], hyb[seed], spec, seed))
            occupied[seed].add(seedDirs.size - 1)

            // Neighbor's VSEPR slot: the last slot is used by the seed
            val nbrDirs = vseprPositions(floatTriple(-1f, 0f, 0f), nSubstituents(spec.atoms[firstNbr], hyb[firstNbr], spec, firstNbr))
            occupied[firstNbr].add(nbrDirs.size - 1)
        }

        // BFS placement
        var changed = true
        while (changed) {
            changed = false
            for (p in 0 until n) {
                if (!placed[p]) continue
                val pBonds = spec.bonds.filter { b -> b.first == p || b.second == p }
                val unplacedNbrs = pBonds.filter { b ->
                    val nbr = if (b.first == p) b.second else b.first
                    !placed[nbr]
                }
                if (unplacedNbrs.isEmpty()) continue

                val placedNbrs = pBonds.filter { b ->
                    val nbr = if (b.first == p) b.second else b.first
                    placed[nbr] && nbr != p
                }
                // Average direction of placed neighbors
                val avgDir = FloatArray(3)
                for (pb in placedNbrs) {
                    val nbr = if (pb.first == p) pb.second else pb.first
                    avgDir[0] += pos[nbr][0] - pos[p][0]
                    avgDir[1] += pos[nbr][1] - pos[p][1]
                    avgDir[2] += pos[nbr][2] - pos[p][2]
                }
                val avgLen = sqrt(avgDir[0] * avgDir[0] + avgDir[1] * avgDir[1] + avgDir[2] * avgDir[2])
                if (avgLen < 0.001) { avgDir[0] = 1f; avgDir[1] = 0f; avgDir[2] = 0f }
                else { avgDir[0] /= avgLen; avgDir[1] /= avgLen; avgDir[2] /= avgLen }

                val dirs = vseprPositions(avgDir, nSubstituents(spec.atoms[p], hyb[p], spec, p))
                val used = occupied[p]

                for (pb in unplacedNbrs) {
                    val nbr = if (pb.first == p) pb.second else pb.first
                    val ord = pb.third

                    // Pick next unused slot
                    var slot = -1
                    for (s in 0 until dirs.size) {
                        if (s !in used) { slot = s; break }
                    }
                    if (slot < 0) continue

                    val bl = bondLen(spec.atoms[p], spec.atoms[nbr], ord)
                    val d = dirs[slot]
                    pos[nbr][0] = pos[p][0] + d[0] * bl; pos[nbr][1] = pos[p][1] + d[1] * bl; pos[nbr][2] = pos[p][2] + d[2] * bl
                    placed[nbr] = true

                    used.add(slot)

                    // Neighbor's slot toward us = last vsepr direction (-d)
                    val nbrDirs = vseprPositions(negate(d), nSubstituents(spec.atoms[nbr], hyb[nbr], spec, nbr))
                    occupied[nbr].add(nbrDirs.size - 1)

                    changed = true
                }
            }
        }

        // 3) Build AtomData/BondData + add H atoms
        val atoms = mutableListOf<AtomData>()
        val bonds = mutableListOf<BondData>()
        var hIdx = n

        // Heavy atoms
        for (i in 0 until n) {
            val p = pos[i]
            atoms.add(AtomData(i, spec.atoms[i], x = p[0], y = p[1], z = p[2], hybridization = hyb[i]))
        }
        for (b in spec.bonds) {
            bonds.add(BondData(bonds.size, b.first, b.second, b.third))
        }

        // Hydrogen placement
        val VALENCE = mapOf("C" to 4, "N" to 3, "O" to 2, "H" to 1, "F" to 1, "Cl" to 1, "Br" to 1, "I" to 1, "S" to 2, "P" to 3)
        for (i in 0 until n) {
            val el = spec.atoms[i]
            if (el == "H") continue
            val pBonds = spec.bonds.filter { b -> b.first == i || b.second == i }
            val v = VALENCE[el] ?: 4
            val sigma = pBonds.size
            val pi = pBonds.count { b -> b.third >= 2 }
            val maxH = max(0, v - sigma - pi)
            if (maxH == 0) continue

            val placedNbrs = pBonds.filter { b ->
                val nbr = if (b.first == i) b.second else b.first
                placed[nbr] && nbr != i
            }
            val avgDir = FloatArray(3)
            if (placedNbrs.isNotEmpty()) {
                val pb = placedNbrs[0]
                val nbr = if (pb.first == i) pb.second else pb.first
                avgDir[0] = pos[nbr][0] - pos[i][0]; avgDir[1] = pos[nbr][1] - pos[i][1]; avgDir[2] = pos[nbr][2] - pos[i][2]
            }
            val avgLen = sqrt(avgDir[0] * avgDir[0] + avgDir[1] * avgDir[1] + avgDir[2] * avgDir[2])
            if (avgLen < 0.001) { avgDir[0] = 1f; avgDir[1] = 0f; avgDir[2] = 0f }
            else { avgDir[0] /= avgLen; avgDir[1] /= avgLen; avgDir[2] /= avgLen }

            val dirs = vseprPositions(avgDir, nSubstituents(el, hyb[i], spec, i))
            val used = occupied[i]
            var hPlaced = 0
            for (s in 0 until dirs.size) {
                if (s in used) continue
                if (hPlaced >= maxH) break
                hPlaced++
                val d = dirs[s]
                val bl = if (el == "O") BL_OH else if (el == "N") BL_NH else BL_CH
                atoms.add(AtomData(hIdx, "H", x = pos[i][0] + d[0] * bl, y = pos[i][1] + d[1] * bl, z = pos[i][2] + d[2] * bl))
                bonds.add(BondData(bonds.size, i, hIdx, 1))
                hIdx++
            }
        }

        // H2O special case
        if (n == 1 && spec.atoms[0] == "O" && spec.bonds.isEmpty() && hIdx <= n) {
            val ang = Math.toRadians(104.5) / 2.0
            for (s in listOf(-1, 1)) {
                val hDir = floatTriple(
                    (s * sin(ang)).toFloat(), cos(ang).toFloat(), 0f
                ).let { normalize(it) }
                atoms.add(AtomData(hIdx, "H", x = hDir[0] * BL_OH, y = hDir[1] * BL_OH, z = 0f))
                bonds.add(BondData(bonds.size, 0, hIdx, 1))
                hIdx++
            }
        }

        // NH3 special case
        if (n == 1 && spec.atoms[0] == "N" && spec.bonds.isEmpty() && hIdx <= n) {
            val baseAng = Math.toRadians(107.0)
            val up = floatTriple(0f, -1f, 0f)
            for (i in 0 until 3) {
                val a = (i / 3.0) * PI * 2
                val dir = floatTriple(
                    (sin(baseAng) * cos(a)).toFloat(),
                    (-cos(baseAng)).toFloat(),
                    (sin(baseAng) * sin(a)).toFloat()
                )
                atoms.add(AtomData(hIdx, "H", x = dir[0] * BL_NH, y = dir[1] * BL_NH, z = dir[2] * BL_NH))
                bonds.add(BondData(bonds.size, 0, hIdx, 1))
                hIdx++
            }
        }

        val smiles = canonicalSmiles(spec.atoms, spec.bonds)
        val name = NAME_MAP[key] ?: key

        return MoleculeData(formula, name, smiles, atoms, bonds)
    }

    // ── VSEPR positions (matching vseprPositions in geometry.ts) ──

    /**
     * Return `count` normalized direction vectors, given a fixed `toward`
     * direction (e.g. pointing toward a bonded neighbor). The LAST element
     * is always the toward direction; earlier elements are substituent
     * positions arranged by VSEPR geometry.
     */
    private fun vseprPositions(toward: FloatArray, count: Int): List<FloatArray> {
        if (count <= 0) return emptyList()
        val d = normalize(toward)
        return when (count) {
            1 -> listOf(negate(d))                                                      // opposite
            2 -> listOf(negate(d), d)                                                   // linear
            3 -> {                                                                     // trigonal planar
                val perp = findPerp(d)
                val c120 = -0.5f; val s120 = 0.86602545f
                val a0 = normalize(floatTriple(
                    d[0] * c120 + perp[0] * s120,
                    d[1] * c120 + perp[1] * s120,
                    d[2] * c120 + perp[2] * s120))
                val a1 = normalize(floatTriple(
                    d[0] * c120 - perp[0] * s120,
                    d[1] * c120 - perp[1] * s120,
                    d[2] * c120 - perp[2] * s120))
                listOf(a0, a1, d)
            }
            4 -> {                                                                     // tetrahedral
                val perp = findPerp(d)
                val cosT = cos(TET_RAD).toFloat(); val sinT = sin(TET_RAD).toFloat()
                val positions = mutableListOf<FloatArray>()
                for (i in 0 until 3) {
                    val angle = (i / 3f) * PI.toFloat() * 2f
                    val ca = cos(angle); val sa = sin(angle)
                    // rotate perp around d by angle
                    val rp = rotateAround(perp, d, angle)
                    positions.add(normalize(floatTriple(
                        d[0] * cosT + rp[0] * sinT,
                        d[1] * cosT + rp[1] * sinT,
                        d[2] * cosT + rp[2] * sinT)))
                }
                positions.add(d)
                positions
            }
            else -> emptyList()
        }
    }

    // ── Vector utilities ──

    private fun floatTriple(x: Float, y: Float, z: Float) = floatArrayOf(x, y, z)

    private fun normalize(v: FloatArray): FloatArray {
        val len = sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
        if (len < 1e-8f) return floatArrayOf(0f, 0f, 1f)
        return floatArrayOf(v[0] / len, v[1] / len, v[2] / len)
    }

    private fun negate(v: FloatArray) = floatArrayOf(-v[0], -v[1], -v[2])

    private fun cross(a: FloatArray, b: FloatArray) = floatArrayOf(
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    )

    private fun dot(a: FloatArray, b: FloatArray) = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

    private fun findPerp(v: FloatArray): FloatArray {
        val ax = abs(v[0]); val ay = abs(v[1]); val az = abs(v[2])
        val up = if (ax <= ay && ax <= az) floatTriple(1f, 0f, 0f)
                 else if (ay <= az) floatTriple(0f, 1f, 0f)
                 else floatTriple(0f, 0f, 1f)
        return normalize(cross(v, up))
    }

    /** Rotate vector `v` around axis `k` by `angle` radians (right-hand rule). */
    private fun rotateAround(v: FloatArray, k: FloatArray, angle: Float): FloatArray {
        val cosA = cos(angle); val sinA = sin(angle)
        val kd = dot(k, v)
        val kc = cross(k, v)
        return floatArrayOf(
            v[0] * cosA + kc[0] * sinA + k[0] * kd * (1f - cosA),
            v[1] * cosA + kc[1] * sinA + k[1] * kd * (1f - cosA),
            v[2] * cosA + kc[2] * sinA + k[2] * kd * (1f - cosA)
        )
    }

    // ── Hybridisation ──

    private fun getHybrid(el: String, spec: BondSpec, idx: Int): Hybrid {
        val my = spec.bonds.filter { b -> b.first == idx || b.second == idx }
        val maxOrd = my.maxOfOrNull { b -> b.third } ?: 1
        val nHeavy = my.size
        if (el == "C") {
            if (maxOrd >= 3) return "sp"
            if (maxOrd == 2 && nHeavy == 2) return "sp"
            if (maxOrd == 2) return "sp2"
            return "sp3"
        }
        if (el == "O") {
            if (maxOrd == 2) return "sp2"
            return "sp3"
        }
        if (el == "N") {
            if (maxOrd == 2) return "sp2"
            return "sp3"
        }
        return "sp3"
    }

    /** How many VSEPR directions for this atom (including H positions + lone pairs) */
    private fun nSubstituents(el: String, hyb: Hybrid, spec: BondSpec, idx: Int): Int {
        if (el == "O") {
            if (hyb == "sp2") return 2
            return 4 // sp3: 2 lone pairs + 2 bonding
        }
        if (el == "N") {
            if (hyb == "sp3") return 4  // 3 bonding + 1 lone pair
            if (hyb == "sp2") return 3  // 2 bonding + 1 lone pair
        }
        if (hyb == "sp") return 2
        if (hyb == "sp2") return 3
        return 4 // sp3
    }

    // ── Bond lengths ──

    private fun bondLen(el1: String, el2: String, order: Int): Float = when {
        (el1 == "C" || el1 == "O") && (el2 == "C" || el2 == "O") -> {
            if (order == 3) BL_CC3
            else if (order == 2) BL_CO2
            else if (el1 == "O" || el2 == "O") BL_CO
            else BL_CC
        }
        (el1 == "C" || el1 == "N") && (el2 == "C" || el2 == "N") -> BL_CN
        (el1 == "H" || el2 == "H") -> BL_CH
        (el1 == "C" || el2 == "C") -> BL_CC
        else -> 1.40f
    }

    // ── Name / alias helpers ──

    private fun canonicalSmiles(atoms: List<String>, bonds: List<Triple<Int, Int, Int>>): String {
        val formula = FormulaParser.formulaToCanonical(atoms.groupingBy { it }.eachCount())
        return formula
    }
}
