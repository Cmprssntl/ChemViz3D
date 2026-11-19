import * as THREE from "three";
import { ATOMIC_DATA } from "../../utils/formulaParser";
import { atomRenderRadius } from "../config";
import type { AtomData, DisplayMode } from "../../types/molecule";

interface AtomStyle {
  radius: number;
  color: string;
  shininess: number;
  specular: number;
}

/**
 * Shares sphere geometries, materials and label textures between atoms of the
 * same element.
 *
 * The naive builder created a 32x32 sphere and a canvas texture per atom, so a
 * C40 chain allocated 122 geometries and 122 textures every time it was
 * rebuilt (and bond rotation rebuilds frequently). With per-element caching the
 * same structure needs ~10 of each.
 *
 * The cache owns its resources: `dispose()` is the single place that frees
 * them, and per-mesh disposal skips anything marked `userData.shared`.
 */
export class MeshResources {
  private readonly spheres = new Map<string, THREE.SphereGeometry>();
  private readonly atomMaterials = new Map<string, THREE.MeshPhongMaterial>();
  private readonly labelTextures = new Map<string, THREE.CanvasTexture>();
  private readonly labelMaterials = new Map<string, THREE.SpriteMaterial>();

  atomMesh(atom: AtomData, mode: DisplayMode): THREE.Mesh {
    const style = styleFor(atom.element, mode);
    const mesh = new THREE.Mesh(this.sphere(atom.element, mode, style.radius), this.atomMaterial(atom.element, mode, style));
    mesh.position.set(atom.x, atom.y, atom.z);
    mesh.userData = { type: "atom", index: atom.index, element: atom.element, shared: true };
    mesh.name = `atom-${atom.index}`;
    return mesh;
  }

  label(atom: AtomData): THREE.Sprite {
    const sprite = new THREE.Sprite(this.labelMaterial(atom.element));
    const radius = atomRenderRadius(atom.element);
    sprite.position.set(atom.x, atom.y + radius + 0.25, atom.z);
    sprite.scale.set(0.6, 0.6, 1);
    sprite.userData = { type: "label", atomIndex: atom.index, shared: true };
    sprite.name = `label-${atom.index}`;
    return sprite;
  }

  dispose(): void {
    for (const geometry of this.spheres.values()) geometry.dispose();
    for (const material of this.atomMaterials.values()) material.dispose();
    for (const material of this.labelMaterials.values()) material.dispose();
    for (const texture of this.labelTextures.values()) texture.dispose();
    this.spheres.clear();
    this.atomMaterials.clear();
    this.labelMaterials.clear();
    this.labelTextures.clear();
  }

  private sphere(element: string, mode: DisplayMode, radius: number): THREE.SphereGeometry {
    const key = `${element}:${mode}`;
    let geometry = this.spheres.get(key);
    if (!geometry) {
      geometry = new THREE.SphereGeometry(radius, 32, 32);
      this.spheres.set(key, geometry);
    }
    return geometry;
  }

  private atomMaterial(element: string, mode: DisplayMode, style: AtomStyle): THREE.MeshPhongMaterial {
    const key = `${element}:${mode}`;
    let material = this.atomMaterials.get(key);
    if (!material) {
      material = new THREE.MeshPhongMaterial({
        color: style.color,
        shininess: style.shininess,
        specular: new THREE.Color(style.specular),
      });
      this.atomMaterials.set(key, material);
    }
    return material;
  }

  private labelMaterial(element: string): THREE.SpriteMaterial {
    let material = this.labelMaterials.get(element);
    if (material) return material;
    const texture = this.labelTexture(element);
    this.labelTextures.set(element, texture);
    material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.labelMaterials.set(element, material);
    return material;
  }

  private labelTexture(element: string): THREE.CanvasTexture {
    const fontSize = 48;
    const padding = 10;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    context.font = `bold ${fontSize}px -apple-system, "Segoe UI", Arial, sans-serif`;
    const textWidth = context.measureText(element).width;
    const size = Math.max(textWidth + padding * 2, fontSize + padding * 2);
    canvas.width = size;
    canvas.height = size;

    context.beginPath();
    context.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    context.fillStyle = "rgba(13, 13, 26, 0.55)";
    context.fill();

    context.font = `bold ${fontSize}px -apple-system, "Segoe UI", Arial, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = ATOMIC_DATA[element]?.color || "#808080";
    context.fillText(element, size / 2, size / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }
}

function styleFor(element: string, mode: DisplayMode): AtomStyle {
  const data = ATOMIC_DATA[element];
  return {
    radius: mode === "ball-and-stick"
      ? Math.max(0.08, (data?.covalentRadius || 76) / 200)
      : Math.max(0.4, (data?.vdwRadius || 170) / 100),
    color: data?.color || "#808080",
    shininess: mode === "ball-and-stick" ? 80 : 30,
    specular: mode === "ball-and-stick" ? 0x444444 : 0x222222,
  };
}
