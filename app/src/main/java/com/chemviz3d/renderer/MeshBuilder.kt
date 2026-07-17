package com.chemviz3d.renderer

import android.opengl.GLES20
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.ShortBuffer
import kotlin.math.*

// ── Sphere and cylinder mesh generation ──

object MeshBuilder {

    private const val SPHERE_SLICES = 20
    private const val SPHERE_STACKS = 20
    private const val CYLINDER_SLICES = 16

    data class MeshData(
        val vertexBuffer: FloatBuffer,
        val normalBuffer: FloatBuffer,
        val elementBuffer: ShortBuffer,
        val vertexCount: Int
    )

    fun buildSphere(radius: Float): MeshData {
        val vertices = mutableListOf<Float>()
        val normals = mutableListOf<Float>()
        val elements = mutableListOf<Short>()

        for (i in 0..SPHERE_STACKS) {
            val phi = PI.toFloat() * i / SPHERE_STACKS
            for (j in 0..SPHERE_SLICES) {
                val theta = 2f * PI.toFloat() * j / SPHERE_SLICES
                val x = sin(phi) * cos(theta)
                val y = cos(phi)
                val z = sin(phi) * sin(theta)
                normals.addAll(listOf(x, y, z))
                vertices.addAll(listOf(x * radius, y * radius, z * radius))
            }
        }

        for (i in 0 until SPHERE_STACKS) {
            for (j in 0 until SPHERE_SLICES) {
                val first = (i * (SPHERE_SLICES + 1) + j).toShort()
                val second = (first + SPHERE_SLICES + 1).toShort()
                elements.addAll(listOf(first, second, (first + 1).toShort()))
                elements.addAll(listOf(second, (second + 1).toShort(), (first + 1).toShort()))
            }
        }

        return toBuffers(vertices, normals, elements)
    }

    fun buildCylinder(length: Float, radius: Float): MeshData {
        val vertices = mutableListOf<Float>()
        val normals = mutableListOf<Float>()
        val elements = mutableListOf<Short>()

        val halfLen = length / 2f

        for (i in 0..CYLINDER_SLICES) {
            val theta = 2f * PI.toFloat() * i / CYLINDER_SLICES
            val x = cos(theta)
            val z = sin(theta)
            // Top
            normals.addAll(listOf(x, 0f, z))
            vertices.addAll(listOf(x * radius, halfLen, z * radius))
            // Bottom
            normals.addAll(listOf(x, 0f, z))
            vertices.addAll(listOf(x * radius, -halfLen, z * radius))
        }

        for (i in 0 until CYLINDER_SLICES) {
            val a = (i * 2).toShort()
            val b = (i * 2 + 1).toShort()
            val c = ((i + 1) % CYLINDER_SLICES * 2).toShort()
            val d = ((i + 1) % CYLINDER_SLICES * 2 + 1).toShort()
            elements.addAll(listOf(a, c, b, c, d, b))
        }

        // End caps
        val capCenterTop = (CYLINDER_SLICES + 1) * 2
        val capCenterBot = capCenterTop + 1

        // Top cap center
        normals.addAll(listOf(0f, 1f, 0f))
        vertices.addAll(listOf(0f, halfLen, 0f))
        // Bottom cap center
        normals.addAll(listOf(0f, -1f, 0f))
        vertices.addAll(listOf(0f, -halfLen, 0f))

        for (i in 0 until CYLINDER_SLICES) {
            val a = (i * 2).toShort()
            val b = ((i + 1) % CYLINDER_SLICES * 2).toShort()
            elements.addAll(listOf(capCenterTop.toShort(), a, b))
            val a2 = (i * 2 + 1).toShort()
            val b2 = ((i + 1) % CYLINDER_SLICES * 2 + 1).toShort()
            elements.addAll(listOf(capCenterBot.toShort(), a2, b2))
        }

        return toBuffers(vertices, normals, elements)
    }

    private fun toBuffers(vertices: List<Float>, normals: List<Float>, elements: List<Short>): MeshData {
        val vBuf = ByteBuffer.allocateDirect(vertices.size * 4)
            .order(ByteOrder.nativeOrder()).asFloatBuffer()
        vBuf.put(vertices.toFloatArray()).position(0)

        val nBuf = ByteBuffer.allocateDirect(normals.size * 4)
            .order(ByteOrder.nativeOrder()).asFloatBuffer()
        nBuf.put(normals.toFloatArray()).position(0)

        val eBuf = ByteBuffer.allocateDirect(elements.size * 2)
            .order(ByteOrder.nativeOrder()).asShortBuffer()
        eBuf.put(elements.toShortArray()).position(0)

        return MeshData(vBuf, nBuf, eBuf, elements.size)
    }
}
