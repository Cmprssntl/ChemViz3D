package com.chemviz3d.engine

import kotlin.math.*

// VSEPR geometry utilities

data class Vec3(val x: Float, val y: Float, val z: Float) {
    fun normalize(): Vec3 {
        val len = sqrt((x * x + y * y + z * z).toDouble()).toFloat()
        return if (len < 1e-10f) Vec3(0f, 0f, 1f) else Vec3(x / len, y / len, z / len)
    }
    fun cross(other: Vec3) = Vec3(
        y * other.z - z * other.y,
        z * other.x - x * other.z,
        x * other.y - y * other.x
    )
    fun dot(other: Vec3) = x * other.x + y * other.y + z * other.z
    fun minus(other: Vec3) = Vec3(x - other.x, y - other.y, z - other.z)
    fun plus(other: Vec3) = Vec3(x + other.x, y + other.y, z + other.z)
    fun times(s: Float) = Vec3(x * s, y * s, z * s)
    fun length() = sqrt((x * x + y * y + z * z).toDouble()).toFloat()
    fun distanceTo(other: Vec3) = this.minus(other).length()
    fun angleBetween(other: Vec3): Double {
        val d = this.dot(other) / (this.length() * other.length())
        return acos(d.toDouble().coerceIn(-1.0, 1.0))
    }
    fun toFloatArray() = floatArrayOf(x, y, z)
    fun rotate(axis: Vec3, angleDeg: Float): Vec3 {
        // Rodrigues' rotation formula
        val a = angleDeg * PI.toFloat() / 180f
        val n = axis.normalize()
        val cosA = cos(a)
        val sinA = sin(a)
        val vDot = this.dot(n)
        return this.times(cosA).plus(n.cross(this).times(sinA)).plus(n.times(vDot * (1f - cosA)))
    }
}

object GeometryEngine {

    /** Generate VSEPR-directed unit vectors for a given hybridization */
    fun vseprVectors(hybridization: String, count: Int): List<Vec3> = when (hybridization) {
        "sp" -> listOf(Vec3(0f, 0f, 1f), Vec3(0f, 0f, -1f))
        "sp2" -> {
            val a = 2f * PI.toFloat() / 3f
            listOf(
                Vec3(0f, 1f, 0f),
                Vec3(cos(a), -sin(a), 0f),
                Vec3(-cos(a), -sin(a), 0f)
            ).map { it.normalize() }
        }
        "sp3" -> listOf(
            Vec3(1f, 1f, 1f), Vec3(1f, -1f, -1f),
            Vec3(-1f, 1f, -1f), Vec3(-1f, -1f, 1f)
        ).map { it.normalize() }
        "sp3d" -> {
            val list = vseprVectors("sp3", 4).toMutableList()
            list.add(Vec3(0f, 0f, 1f))
            list.take(count)
        }
        else -> vseprVectors("sp3", count.coerceAtMost(4))
    }

    /** Bond length in Angstroms for the given element pair */
    fun bondLength(el1: String, el2: String, order: Int = 1): Float = when {
        el1 == "C" && el2 == "C" -> when (order) { 2 -> 1.34f; 3 -> 1.20f; else -> 1.54f }
        (el1 == "C" && el2 == "H") || (el1 == "H" && el2 == "C") -> 1.09f
        (el1 == "C" && el2 == "O") || (el1 == "O" && el2 == "C") -> when (order) { 2 -> 1.20f; else -> 1.43f }
        (el1 == "O" && el2 == "H") || (el1 == "H" && el2 == "O") -> 0.96f
        (el1 == "C" && el2 == "N") || (el1 == "N" && el2 == "C") -> when (order) { 2 -> 1.27f; 3 -> 1.15f; else -> 1.47f }
        (el1 == "N" && el2 == "H") || (el1 == "H" && el2 == "N") -> 1.01f
        else -> 1.50f
    }

    /** Van der Waals radius for space-filling models */
    fun vdwRadius(element: String): Float = when (element) {
        "H" -> 1.20f; "C" -> 1.70f; "N" -> 1.55f; "O" -> 1.52f
        "F" -> 1.47f; "Cl" -> 1.75f; "Br" -> 1.85f; "I" -> 1.98f
        "S" -> 1.80f; "P" -> 1.80f; else -> 1.50f
    }

    /** Covalent radius for ball-and-stick */
    fun covalentRadius(element: String): Float = when (element) {
        "H" -> 0.37f; "C" -> 0.77f; "N" -> 0.75f; "O" -> 0.73f
        "F" -> 0.71f; "Cl" -> 0.99f; "Br" -> 1.14f; "I" -> 1.33f
        "S" -> 1.03f; "P" -> 1.06f; else -> 0.80f
    }

    fun atomicMass(element: String): Double = when (element) {
        "H" -> 1.008; "C" -> 12.011; "N" -> 14.007; "O" -> 15.999
        "F" -> 18.998; "Cl" -> 35.45; "Br" -> 79.904; "I" -> 126.904
        "S" -> 32.06; "P" -> 30.974; else -> 0.0
    }

    fun elementColor(element: String): FloatArray = when (element) {
        "C" -> floatArrayOf(0.4f, 0.4f, 0.4f)
        "H" -> floatArrayOf(0.9f, 0.9f, 0.9f)
        "O" -> floatArrayOf(1.0f, 0.0f, 0.0f)
        "N" -> floatArrayOf(0.2f, 0.2f, 1.0f)
        "F" -> floatArrayOf(0.0f, 0.8f, 0.0f)
        "Cl" -> floatArrayOf(0.0f, 1.0f, 0.0f)
        "Br" -> floatArrayOf(0.6f, 0.2f, 0.0f)
        "I" -> floatArrayOf(0.5f, 0.0f, 0.5f)
        "S" -> floatArrayOf(1.0f, 1.0f, 0.0f)
        "P" -> floatArrayOf(1.0f, 0.5f, 0.0f)
        else -> floatArrayOf(0.5f, 0.5f, 0.8f)
    }
}
