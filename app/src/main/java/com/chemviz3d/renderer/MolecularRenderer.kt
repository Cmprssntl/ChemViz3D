package com.chemviz3d.renderer

import android.opengl.GLES20
import android.opengl.GLSurfaceView
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import com.chemviz3d.model.*
import com.chemviz3d.engine.GeometryEngine
import com.chemviz3d.engine.CoplanarityDetector

class MolecularRenderer : GLSurfaceView.Renderer {
    var molecule: MoleculeData? = null
    var displayMode: String = "ball-and-stick"
    var highlightCoplanar: Boolean = false

    val scene = Scene3D()

    // Pre-built meshes
    private var sphereBondRadius = 0.15f
    private val sphereCache = mutableMapOf<Float, MeshBuilder.MeshData>()
    private val cylinderCache = mutableMapOf<Pair<Float, Float>, MeshBuilder.MeshData>()

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        GLES20.glClearColor(0.067f, 0.067f, 0.133f, 1.0f) // matches #111122
        scene.shader = ShaderProgram(ShaderProgram.VERTEX_SHADER, ShaderProgram.FRAGMENT_SHADER)
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        GLES20.glViewport(0, 0, width, height)
        scene.setPerspective(width.toFloat(), height.toFloat())
    }

    override fun onDrawFrame(gl: GL10?) {
        buildScene()
        scene.render()
    }

    fun buildScene() {
        scene.clearMeshes()

        val mol = molecule ?: return

        // Auto-fit camera: use the first atom as the focal point (typically the
        // anchor of the SMILES tree, at origin). This keeps the central atom
        // visible rather than letting the camera target float between atoms.
        if (mol.atoms.isNotEmpty()) {
            val anchor = mol.atoms[0]
            val minX = mol.atoms.minOf { it.x }
            val maxX = mol.atoms.maxOf { it.x }
            val minY = mol.atoms.minOf { it.y }
            val maxY = mol.atoms.maxOf { it.y }
            val minZ = mol.atoms.minOf { it.z }
            val maxZ = mol.atoms.maxOf { it.z }
            val size = kotlin.math.max(
                kotlin.math.max(maxX - minX, maxY - minY),
                maxZ - minZ
            )
            // Camera distance: ~3.5x the molecule size, min 6, max 30
            val camDist = (size * 3.5f).coerceIn(6f, 30f)
            // Target slightly offset toward the first atom (so it's not behind
            // other atoms from the default camera angle)
            scene.targetX = anchor.x
            scene.targetY = anchor.y
            scene.targetZ = anchor.z
            // Keep current camera angle but adjust distance. If the camera is
            // at the default (0, 0, camDist), reset to a tilted angle.
            val dirLen = kotlin.math.sqrt(
                scene.cameraX * scene.cameraX +
                scene.cameraY * scene.cameraY +
                scene.cameraZ * scene.cameraZ
            )
            if (dirLen < 0.1f) {
                // Default position: tilted view from front-top-right
                scene.cameraX = camDist * 0.6f
                scene.cameraY = camDist * 0.5f
                scene.cameraZ = camDist * 0.7f
            } else {
                val scale = camDist / dirLen
                scene.cameraX *= scale
                scene.cameraY *= scale
                scene.cameraZ *= scale
            }
        }

        for (atom in mol.atoms) {
            val r = if (displayMode == "space-filling") {
                GeometryEngine.vdwRadius(atom.element)
            } else {
                GeometryEngine.covalentRadius(atom.element) * 0.6f
            }
            val mesh = sphereCache.getOrPut(r) { MeshBuilder.buildSphere(r) }
            val color = GeometryEngine.elementColor(atom.element)
            scene.addMesh(RenderableMesh(
                mesh = mesh,
                positionX = atom.x,
                positionY = atom.y,
                positionZ = atom.z,
                colorR = color[0], colorG = color[1], colorB = color[2]
            ))
        }

        if (displayMode != "space-filling") {
            for (bond in mol.bonds) {
                val a1 = mol.atoms[bond.atom1Idx]
                val a2 = mol.atoms[bond.atom2Idx]
                val dx = a2.x - a1.x
                val dy = a2.y - a1.y
                val dz = a2.z - a1.z
                val length = kotlin.math.sqrt(dx * dx + dy * dy + dz * dz)
                if (length < 0.001f) continue

                val cylinderMesh = cylinderCache.getOrPut(Pair(length, sphereBondRadius)) {
                    MeshBuilder.buildCylinder(length, sphereBondRadius)
                }
                val midX = (a1.x + a2.x) / 2f
                val midY = (a1.y + a2.y) / 2f
                val midZ = (a1.z + a2.z) / 2f

                // Rotation from Y-axis to bond direction.
                // The correct axis is the cross product of (0,1,0) and bond dir:
                //   cross = (1*dz - 0*dy, 0*dx - 0*dz, 0*dy - 1*dx) = (dz, 0, -dx)
                // Using the negative (i.e. -dz, dx) would rotate the cylinder
                // away from the bond direction.
                val angle = kotlin.math.acos((dy / length).toDouble().coerceIn(-1.0, 1.0)).toFloat() * 180f / kotlin.math.PI.toFloat()
                val axisX = dz
                val axisZ = -dx
                val (rotX, rotZ) = if (kotlin.math.abs(axisX) < 0.001f && kotlin.math.abs(axisZ) < 0.001f) {
                    1f to 0f
                } else {
                    val len = kotlin.math.sqrt(axisX * axisX + axisZ * axisZ)
                    (axisX / len) to (axisZ / len)
                }

                scene.addMesh(RenderableMesh(
                    mesh = cylinderMesh,
                    positionX = midX,
                    positionY = midY,
                    positionZ = midZ,
                    rotationAxisX = rotX,
                    rotationAxisY = 0f,
                    rotationAxisZ = rotZ,
                    rotationAngle = angle,
                    colorR = 0.5f, colorG = 0.5f, colorB = 0.5f
                ))
            }
        }

        // Add coplanarity indicators
        if (highlightCoplanar && mol.atoms.isNotEmpty()) {
            val fragments = CoplanarityDetector.detectFragments(mol)
            if (fragments.isNotEmpty()) {
                val merged = CoplanarityDetector.countMaxPlanarAtoms(mol)
                // Semi-transparent plane overlay
                for (idx in merged.largestIndices.take(5)) {
                    val atom = mol.atoms[idx]
                    // Highlight ring
                    val ring = MeshBuilder.buildSphere(0.4f)
                    scene.addMesh(RenderableMesh(
                        mesh = ring,
                        positionX = atom.x,
                        positionY = atom.y,
                        positionZ = atom.z,
                        colorR = 0.267f, colorG = 0.667f, colorB = 1f // #44aaff
                    ))
                }
            }
        }
    }
}
