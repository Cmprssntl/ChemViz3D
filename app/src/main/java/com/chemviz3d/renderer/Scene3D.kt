package com.chemviz3d.renderer

import android.opengl.GLES20
import android.opengl.Matrix
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.ShortBuffer
import kotlin.math.*

// ── OpenGL Shader Program ──

class ShaderProgram(vertexSource: String, fragmentSource: String) {
    val programId: Int
    val aPosition: Int
    val aNormal: Int
    val uMVPMatrix: Int
    val uModelMatrix: Int
    val uColor: Int
    val uLightPos: Int

    init {
        programId = createProgram(vertexSource, fragmentSource)
        aPosition = GLES20.glGetAttribLocation(programId, "aPosition")
        aNormal = GLES20.glGetAttribLocation(programId, "aNormal")
        uMVPMatrix = GLES20.glGetUniformLocation(programId, "uMVPMatrix")
        uModelMatrix = GLES20.glGetUniformLocation(programId, "uModelMatrix")
        uColor = GLES20.glGetUniformLocation(programId, "uColor")
        uLightPos = GLES20.glGetUniformLocation(programId, "uLightPos")
    }

    fun use() { GLES20.glUseProgram(programId) }

    private fun compileShader(type: Int, source: String): Int {
        val shader = GLES20.glCreateShader(type)
        GLES20.glShaderSource(shader, source)
        GLES20.glCompileShader(shader)
        return shader
    }

    private fun createProgram(vertexSrc: String, fragmentSrc: String): Int {
        val vs = compileShader(GLES20.GL_VERTEX_SHADER, vertexSrc)
        val fs = compileShader(GLES20.GL_FRAGMENT_SHADER, fragmentSrc)
        val program = GLES20.glCreateProgram()
        GLES20.glAttachShader(program, vs)
        GLES20.glAttachShader(program, fs)
        GLES20.glLinkProgram(program)
        return program
    }

    companion object {
        val VERTEX_SHADER = """
            uniform mat4 uMVPMatrix;
            uniform mat4 uModelMatrix;
            uniform vec3 uLightPos;
            attribute vec3 aPosition;
            attribute vec3 aNormal;
            varying vec3 vNormal;
            varying vec3 vPosition;
            void main() {
                vec4 worldPos = uModelMatrix * vec4(aPosition, 1.0);
                vPosition = worldPos.xyz;
                vNormal = normalize(mat3(uModelMatrix) * aNormal);
                gl_Position = uMVPMatrix * vec4(aPosition, 1.0);
            }
        """.trimIndent()

        val FRAGMENT_SHADER = """
            precision mediump float;
            uniform vec3 uColor;
            uniform vec3 uLightPos;
            varying vec3 vNormal;
            varying vec3 vPosition;
            void main() {
                vec3 lightDir = normalize(uLightPos - vPosition);
                float diff = max(dot(vNormal, lightDir), 0.15);
                vec3 ambient = 0.35 * uColor;
                vec3 diffuse = diff * uColor;
                gl_FragColor = vec4(ambient + diffuse, 1.0);
            }
        """.trimIndent()
    }
}

// ── Renderable mesh instance ──

class RenderableMesh(
    val mesh: MeshBuilder.MeshData,
    val positionX: Float,
    val positionY: Float,
    val positionZ: Float,
    val rotationAxisX: Float = 0f,
    val rotationAxisY: Float = 0f,
    val rotationAxisZ: Float = 1f,
    val rotationAngle: Float = 0f,
    val colorR: Float = 0.5f,
    val colorG: Float = 0.5f,
    val colorB: Float = 0.8f
)

// ── 3D Scene ──

class Scene3D {
    private val renderables = mutableListOf<RenderableMesh>()
    var cameraX = 0f; var cameraY = 0f; var cameraZ = 8f
    var targetX = 0f; var targetY = 0f; var targetZ = 0f
    var lightX = 5f; var lightY = 10f; var lightZ = 8f

    private val modelMatrix = FloatArray(16)
    private val viewMatrix = FloatArray(16)
    private val projMatrix = FloatArray(16)
    private val mvpMatrix = FloatArray(16)
    private val tempMatrix = FloatArray(16)

    lateinit var shader: ShaderProgram

    fun addMesh(mesh: RenderableMesh) { renderables.add(mesh) }
    fun clearMeshes() { renderables.clear() }

    fun setPerspective(width: Float, height: Float) {
        val aspect = width / height
        Matrix.perspectiveM(projMatrix, 0, 45f, aspect, 0.1f, 100f)
    }

    fun render() {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
        GLES20.glEnable(GLES20.GL_DEPTH_TEST)

        Matrix.setLookAtM(viewMatrix, 0,
            cameraX, cameraY, cameraZ,
            targetX, targetY, targetZ,
            0f, 1f, 0f)

        shader.use()

        for (rm in renderables) {
            Matrix.setIdentityM(modelMatrix, 0)
            Matrix.translateM(modelMatrix, 0, rm.positionX, rm.positionY, rm.positionZ)
            if (rm.rotationAngle != 0f) {
                Matrix.setRotateM(tempMatrix, 0, rm.rotationAngle,
                    rm.rotationAxisX, rm.rotationAxisY, rm.rotationAxisZ)
                Matrix.multiplyMM(modelMatrix, 0, tempMatrix, 0, modelMatrix, 0)
            }
            Matrix.multiplyMM(mvpMatrix, 0, viewMatrix, 0, modelMatrix, 0)
            Matrix.multiplyMM(mvpMatrix, 0, projMatrix, 0, mvpMatrix, 0)

            GLES20.glUniformMatrix4fv(shader.uMVPMatrix, 1, false, mvpMatrix, 0)
            GLES20.glUniformMatrix4fv(shader.uModelMatrix, 1, false, modelMatrix, 0)
            GLES20.glUniform3f(shader.uColor, rm.colorR, rm.colorG, rm.colorB)
            GLES20.glUniform3f(shader.uLightPos, lightX, lightY, lightZ)

            val mesh = rm.mesh
            GLES20.glEnableVertexAttribArray(shader.aPosition)
            GLES20.glVertexAttribPointer(shader.aPosition, 3, GLES20.GL_FLOAT, false, 0, mesh.vertexBuffer)
            GLES20.glEnableVertexAttribArray(shader.aNormal)
            GLES20.glVertexAttribPointer(shader.aNormal, 3, GLES20.GL_FLOAT, false, 0, mesh.normalBuffer)
            GLES20.glDrawElements(GLES20.GL_TRIANGLES, mesh.vertexCount, GLES20.GL_UNSIGNED_SHORT, mesh.elementBuffer)
            GLES20.glDisableVertexAttribArray(shader.aPosition)
            GLES20.glDisableVertexAttribArray(shader.aNormal)
        }
    }

    fun rotateCamera(dx: Float, dy: Float) {
        // Simple orbit rotation
        val dist = sqrt(cameraX * cameraX + cameraY * cameraY + cameraZ * cameraZ)
        val theta = atan2(cameraX.toDouble(), cameraZ.toDouble()).toFloat() + dx * 0.02f
        val phi = asin((cameraY / dist).toDouble()).toFloat() + dy * 0.02f
        val phiClamped = phi.coerceIn(-PI.toFloat() / 2.1f, PI.toFloat() / 2.1f)
        cameraX = dist * cos(phiClamped) * sin(theta)
        cameraZ = dist * cos(phiClamped) * cos(theta)
        cameraY = dist * sin(phiClamped)
    }

    /**
     * Pan the camera target by screen-space deltas. dx, dy are pixel
     * movements (right, down) from a 2-finger drag. The panning happens
     * in the camera's right and up directions, so it feels like the user
     * is grabbing the molecule and dragging it.
     */
    fun pan(dx: Float, dy: Float) {
        val dist = sqrt(cameraX * cameraX + cameraY * cameraY + cameraZ * cameraZ)
        if (dist < 0.1f) return

        // Forward direction (camera -> target)
        val fx = -cameraX / dist
        val fy = -cameraY / dist
        val fz = -cameraZ / dist
        // World up
        val upX = 0f; val upY = 1f; val upZ = 0f
        // Right = forward x up
        var rx = fy * upZ - fz * upY
        var ry = fz * upX - fx * upZ
        var rz = fx * upY - fy * upX
        val rLen = sqrt(rx * rx + ry * ry + rz * rz)
        if (rLen > 0.001f) { rx /= rLen; ry /= rLen; rz /= rLen }
        // True up = right x forward
        val ux = ry * fz - rz * fy
        val uy = rz * fx - rx * fz
        val uz = rx * fy - ry * fx

        // Scale panning by distance so 1 pixel = same world delta regardless of zoom
        val scale = dist * 0.0025f
        targetX += (-rx * dx + ux * dy) * scale
        targetY += (-ry * dx + uy * dy) * scale
        targetZ += (-rz * dx + uz * dy) * scale
        // Move camera by same delta so the relative angle is preserved
        cameraX += (-rx * dx + ux * dy) * scale
        cameraY += (-ry * dx + uy * dy) * scale
        cameraZ += (-rz * dx + uz * dy) * scale
    }

    fun zoom(delta: Float) {
        val dist = sqrt(cameraX * cameraX + cameraY * cameraY + cameraZ * cameraZ)
        val newDist = (dist * (1f - delta * 0.01f)).coerceIn(2f, 30f)
        val scale = newDist / dist
        cameraX *= scale; cameraY *= scale; cameraZ *= scale
    }

    fun resetView() {
        cameraX = 0f; cameraY = 0f; cameraZ = 8f
        targetX = 0f; targetY = 0f; targetZ = 0f
    }
}
