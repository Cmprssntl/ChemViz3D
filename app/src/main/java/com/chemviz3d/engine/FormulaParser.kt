package com.chemviz3d.engine

// ── Chemical formula parser ──

object FormulaParser {
    private val ELEMENT_SYMBOLS = setOf(
        "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne",
        "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
        "Br", "I"
    )

    /** Parse "C2H5OH" → map of element→count */
    fun parse(formula: String): Map<String, Int> {
        val counts = mutableMapOf<String, Int>()
        val upper = formula.trim().replace(" ", "")
        var i = 0
        while (i < upper.length) {
            val c = upper[i]
            if (!c.isLetter()) { i++; continue }

            // Read element symbol: single uppercase, or uppercase+lowercase
            val sym = if (i + 1 < upper.length && upper[i + 1].isLowerCase()) {
                upper.substring(i, i + 2).also { i += 2 }
            } else {
                c.toString().also { i++ }
            }
            if (sym !in ELEMENT_SYMBOLS) continue

            // Read count
            val countStart = i
            while (i < upper.length && upper[i].isDigit()) i++
            val cnt = if (i > countStart) upper.substring(countStart, i).toInt() else 1
            counts[sym] = (counts[sym] ?: 0) + cnt
        }
        return counts
    }

    fun formulaToCanonical(counts: Map<String, Int>): String {
        val order = listOf("C", "H", "O", "N", "S", "P", "F", "Cl", "Br", "I")
        return order.mapNotNull { el ->
            val c = counts[el] ?: return@mapNotNull null
            el + if (c > 1) c.toString() else ""
        }.joinToString("")
    }
}
