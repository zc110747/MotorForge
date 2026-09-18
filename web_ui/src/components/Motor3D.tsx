import { useEffect, useRef } from "react";
import * as THREE from "three";
import { store, rpmOf } from "../sim/store";

const RAD2DEG = 180 / Math.PI;

export function Motor3D() {
  const mountRef = useRef<HTMLDivElement>(null);
  const rotorRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    const mount = mountRef.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e14);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(3.4, 2.6, 4.2);
    camera.lookAt(0, 0, 0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (e) {
      mount.innerHTML =
        '<div style="color:#f87171;padding:24px">3D 需要 WebGL 支持</div>';
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    renderer.domElement.className = "motor-canvas";

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(4, 6, 5);
    scene.add(dir);

    // --- Housing (static) ---
    const housing = new THREE.Mesh(
      new THREE.CylinderGeometry(2.25, 2.25, 1.1, 48, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x2b333d, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide })
    );
    scene.add(housing);

    // --- Stator core (static) + copper coils ---
    const stator = new THREE.Mesh(
      new THREE.CylinderGeometry(2.0, 2.0, 1.2, 48, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x3a4452, metalness: 0.7, roughness: 0.5, side: THREE.DoubleSide })
    );
    scene.add(stator);
    const coilGeo = new THREE.BoxGeometry(0.32, 1.0, 0.32);
    const coilMat = new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.8, roughness: 0.35 });
    const NCOILS = 12;
    for (let i = 0; i < NCOILS; i++) {
      const a = (i / NCOILS) * Math.PI * 2;
      const coil = new THREE.Mesh(coilGeo, coilMat);
      coil.position.set(Math.cos(a) * 1.78, 0, Math.sin(a) * 1.78);
      coil.rotation.y = -a;
      scene.add(coil);
    }

    // --- Rotor group (rotates by simulation.rotor.angle ONLY) ---
    const rotor = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(1.18, 1.18, 1.32, 40),
      new THREE.MeshStandardMaterial({ color: 0x9aa6b2, metalness: 0.85, roughness: 0.3 })
    );
    rotor.add(core);
    const magN = new THREE.MeshStandardMaterial({ color: 0xf87171, metalness: 0.4, roughness: 0.5 });
    const magS = new THREE.MeshStandardMaterial({ color: 0x60a5fa, metalness: 0.4, roughness: 0.5 });
    const NMAG = 8;
    for (let i = 0; i < NMAG; i++) {
      const a = (i / NMAG) * Math.PI * 2;
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.34), i % 2 ? magN : magS);
      mag.position.set(Math.cos(a) * 1.25, 0, Math.sin(a) * 1.25);
      mag.rotation.y = -a;
      rotor.add(mag);
    }
    // reference marker so rotation is visually obvious
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 1.34, 0.18),
      new THREE.MeshStandardMaterial({ color: 0xf5a623, emissive: 0x6b4a00 })
    );
    marker.position.set(0, 0, 1.18);
    rotor.add(marker);
    scene.add(rotor);
    rotorRef.current = rotor;

    const resize = () => {
      const w = mount.clientWidth || 300;
      const h = mount.clientHeight || 300;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      // KEY: rotor angle comes strictly from the simulation snapshot.
      // We never integrate it on the client.
      rotor.rotation.y = store.latest.rotor.angle;
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  const s = store.latest;

  return (
    <div className="panel motor-wrap" style={{ flex: "none" }}>
      <div className="panel-title"><span className="tag">3D</span>电机模型</div>
      <div className="motor-wrap" style={{ marginTop: 8 }}>
        <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />
        <div className="motor-readout">
          angle {((s.rotor.angle * RAD2DEG) % 360).toFixed(1)}° · {rpmOf(s).toFixed(0)} rpm
        </div>
      </div>
    </div>
  );
}
