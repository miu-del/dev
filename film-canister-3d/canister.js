// Procedural "Moments" film canister.
// Units: 1 = canister diameter. The canister axis is local +Y (plain end up, spool end down).
// Node tree (names are kept in the exported GLB so animation tools can target them):
//   FilmCanister            ← place / pose / float this
//     Spin                  ← rotate around Y to roll the label
//       Label               ← blue printed wrap
//       CapTop              ← plain end cap (slides off in the "Open" clip)
//       CapSpool            ← end cap with the spool hub
import * as THREE from 'three';

export const DIM = {
  radius: 0.5,       // label radius
  length: 1.9,       // label length (between the caps)
  capRadius: 0.535,  // outer radius of the metal caps
  capHeight: 0.2,
};

export const COLORS = {
  blue: '#1238e6',
  blueDeep: '#0a1fb8',
  blueLight: '#4d7cf0',
  ink: '#e9ecf8',
  metal: '#141418',
};

// ---------- helpers ----------

// Round every interior corner of a 2D polyline with a quadratic fillet.
function fillet(points, r, steps = 4) {
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], a = points[i - 1], b = points[i + 1];
    const da = p.clone().sub(a), db = b.clone().sub(p);
    const rr = Math.min(r, da.length() / 2, db.length() / 2);
    const p0 = p.clone().sub(da.normalize().multiplyScalar(rr));
    const p1 = p.clone().add(db.normalize().multiplyScalar(rr));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // quadratic bezier p0 → p → p1
      out.push(new THREE.Vector2(
        (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * p.x + t * t * p1.x,
        (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * p.y + t * t * p1.y,
      ));
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

const v = (x, y) => new THREE.Vector2(x, y);

// Profile runs from the body junction, up the outside wall, then inward across the face to the axis,
// so LatheGeometry's normals face outward. y = 0 is where the cap meets the label; +y points away from the body.
function capProfile(spool) {
  const R = DIM.capRadius, r = DIM.radius, H = DIM.capHeight;
  const pts = [
    v(r - 0.004, -0.01),
    v(r + 0.004, 0.0),
    v(R, 0.02),
    v(R, 0.075),
    v(R - 0.012, 0.085),   // rolled seam groove
    v(R, 0.095),
    v(R, H - 0.02),
    v(R - 0.025, H),       // rim lip
  ];
  if (spool) {
    pts.push(
      v(R - 0.06, H),
      v(R - 0.075, H - 0.035),   // recessed dish
      v(0.26, H - 0.035),
      v(0.235, H + 0.035),       // spool hub ring
      v(0.16, H + 0.04),
      v(0.125, H + 0.03),
      v(0.115, H - 0.06),        // hole
      v(0, H - 0.06),
    );
  } else {
    pts.push(
      v(R - 0.07, H),
      v(R - 0.08, H - 0.012),    // pressed ring
      v(R - 0.1, H - 0.012),
      v(R - 0.11, H + 0.002),
      v(0, H + 0.006),
    );
  }
  return fillet(pts, 0.012, 5);
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Cheap seeded RNG so the baked grain is identical every build.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function sprinkle(ctx, w, h, count, color, maxSize, seed, alphaFn) {
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = rand() * w, y = rand() * h;
    const a = alphaFn ? alphaFn(x, y, rand) : rand();
    if (a <= 0) continue;
    ctx.globalAlpha = a;
    ctx.fillStyle = color;
    const s = 0.6 + rand() * maxSize;
    ctx.fillRect(x, y, s, s);
  }
  ctx.globalAlpha = 1;
}

// ---------- textures ----------

// Label: U wraps around the circumference, V runs along the axis (canvas top = CapTop end).
// Text runs along the axis, reading from the CapTop end toward the spool end, like the illustration.
export function makeLabelTexture({ width = 2048, title = 'Moments' } = {}) {
  const W = width;
  const H = Math.round(W * DIM.length / (Math.PI * 2 * DIM.radius));
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');

  // Base: saturated blue with a soft lighter band, as printed on the wrap
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, COLORS.blueDeep);
  g.addColorStop(0.3, COLORS.blue);
  g.addColorStop(0.5, '#2a55f0');
  g.addColorStop(0.7, COLORS.blue);
  g.addColorStop(1, COLORS.blueDeep);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Printed grain: light speckles concentrated toward the band, dark specks everywhere
  sprinkle(ctx, W, H, 26000, '#ffffff', 1.6, 7, (x, y, r) => {
    const band = Math.exp(-(((x / W) - 0.42) ** 2) / 0.02);
    return r() < 0.25 + 0.75 * band ? 0.18 + 0.35 * band : 0;
  });
  sprinkle(ctx, W, H, 14000, '#000a40', 1.8, 11, (x, y, r) => 0.25 + r() * 0.3);

  // Text, rotated so its baseline runs along V
  const centreU = W * 0.5;   // the side of the label facing the camera at Spin = 0
  ctx.save();
  ctx.translate(centreU, 0);
  ctx.rotate(Math.PI / 2);   // text +x → canvas +y (down the axis); letter-up → canvas +x
  // now: x ∈ [0, H] along the axis, y < 0 is "above" the title, y > 0 "below"

  const margin = H * 0.035;
  ctx.fillStyle = COLORS.ink;
  ctx.textBaseline = 'alphabetic';

  // Title — sized to fill the length
  let size = 200;
  ctx.font = `500 ${size}px "Cormorant Garamond", Georgia, serif`;
  const tw = ctx.measureText(title).width;
  size = size * (H - margin * 2) / tw;
  ctx.font = `500 ${size}px "Cormorant Garamond", Georgia, serif`;
  ctx.globalAlpha = 0.94;
  const baseline = size * 0.36; // title sits just below the label's centre line
  ctx.fillText(title, margin, baseline);

  // Small copy
  ctx.globalAlpha = 0.85;
  const small = Math.round(size * 0.1);
  ctx.font = `400 ${small}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  ctx.fillText('Capture together, laugh together', margin + size * 0.02, baseline + small * 2.4);
  ctx.textAlign = 'right';
  ctx.fillText('Shoot the moments from everyone’s', H - margin, baseline + small * 2.4);
  ctx.fillText('perspective in real time', H - margin, baseline + small * 3.7);
  ctx.restore();

  // Grain on top of the ink too, so the type looks printed
  sprinkle(ctx, W, H, 6000, COLORS.blueDeep, 1.4, 23, (x, y, r) => 0.35 * r());

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData.mimeType = 'image/jpeg'; // keeps the exported GLB small
  return tex;
}

// Blotchy roughness for the black metal (darker = glossier)
function makeMetalRoughness(size = 512) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8a8a8a';
  ctx.fillRect(0, 0, size, size);
  sprinkle(ctx, size, size, 9000, '#ffffff', 2.2, 3, (x, y, r) => 0.25 * r());
  sprinkle(ctx, size, size, 9000, '#303030', 2.2, 5, (x, y, r) => 0.3 * r());
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 1);
  tex.userData.mimeType = 'image/jpeg';
  return tex;
}

// ---------- model ----------

export function createFilmCanister({ title = 'Moments', labelWidth = 2048 } = {}) {
  const root = new THREE.Group();
  root.name = 'FilmCanister';
  const spin = new THREE.Group();
  spin.name = 'Spin';
  root.add(spin);

  const labelMat = new THREE.MeshPhysicalMaterial({
    name: 'LabelPrint',
    map: makeLabelTexture({ width: labelWidth, title }),
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.35,
  });
  const label = new THREE.Mesh(
    new THREE.CylinderGeometry(DIM.radius, DIM.radius, DIM.length, 128, 1, true),
    labelMat,
  );
  label.name = 'Label';
  // CylinderGeometry puts u = 0.5 at -Z; turn it so the title faces +Z (the default camera side)
  label.rotation.y = Math.PI;
  spin.add(label);

  const metal = new THREE.MeshStandardMaterial({
    name: 'BlackMetal',
    color: COLORS.metal,
    metalness: 0.55,
    roughness: 0.58,
    roughnessMap: makeMetalRoughness(),
  });

  const capTop = new THREE.Mesh(new THREE.LatheGeometry(capProfile(false), 128), metal);
  capTop.name = 'CapTop';
  capTop.position.y = DIM.length / 2;
  spin.add(capTop);

  const capSpool = new THREE.Mesh(new THREE.LatheGeometry(capProfile(true), 128), metal);
  capSpool.name = 'CapSpool';
  capSpool.rotation.x = Math.PI;
  capSpool.position.y = -DIM.length / 2;
  spin.add(capSpool);

  // Dark plug inside the spool hole so it never reads as see-through
  const plug = new THREE.Mesh(
    new THREE.CircleGeometry(0.116, 48),
    new THREE.MeshStandardMaterial({ name: 'HoleShadow', color: '#050507', roughness: 1 }),
  );
  plug.name = 'SpoolHole';
  plug.rotation.x = Math.PI / 2;
  plug.position.y = -DIM.length / 2 - DIM.capHeight + 0.058;
  spin.add(plug);

  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return root;
}

// The pose of the illustration: axis tipped down to the lower-right, spool end toward the viewer.
// Built from directions so it is easy to tweak: where the spool end points, and where the title should face.
function heroRotation() {
  const toSpool = new THREE.Vector3(0.78, -0.42, 0.5).normalize();  // right, down, toward the viewer
  const y = toSpool.clone().negate();                                // local +Y = plain end
  const view = new THREE.Vector3(-0.1, 0.35, 1);                     // title faces the camera, a touch upward
  const z = view.sub(y.clone().multiplyScalar(view.dot(y))).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z), 'XYZ');
}
export const HERO_POSE = { rotation: heroRotation() };

// ---------- baked clips (exported into the GLB) ----------
// Times in seconds. All clips loop cleanly except Open, which is a one-shot.
export function createClips() {
  const clips = [];
  const q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
  const flat = qs => qs.flatMap(qq => qq.toArray());

  // Idle: gentle bob and sway on the root, slow label drift
  {
    const n = 25, dur = 4, times = [], pos = [], rot = [];
    const base = HERO_POSE.rotation;
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * dur, p = (t / dur) * Math.PI * 2;
      times.push(t);
      pos.push(0, Math.sin(p) * 0.06, 0);
      rot.push(...q(base.x + Math.sin(p) * 0.04, base.y + Math.sin(p + 1) * 0.05, base.z + Math.cos(p) * 0.03).toArray());
    }
    clips.push(new THREE.AnimationClip('Idle', dur, [
      new THREE.VectorKeyframeTrack('FilmCanister.position', times, pos),
      new THREE.QuaternionKeyframeTrack('FilmCanister.quaternion', times, rot),
    ]));
  }

  // Spin: one full turn of the label around its own axis
  {
    const n = 9, dur = 3, times = [], rot = [];
    for (let i = 0; i < n; i++) {
      times.push((i / (n - 1)) * dur);
      rot.push(q(0, (i / (n - 1)) * Math.PI * 2, 0));
    }
    clips.push(new THREE.AnimationClip('Spin', dur, [
      new THREE.QuaternionKeyframeTrack('Spin.quaternion', times, flat(rot)),
    ]));
  }

  // Open: the top cap pops up with a slight tilt, holds, then snaps back
  {
    const y0 = DIM.length / 2;
    const times = [0, 0.18, 0.45, 1.2, 1.45, 1.6];
    const pos = [0, y0, 0, 0, y0 - 0.02, 0, 0, y0 + 0.42, 0.05, 0, y0 + 0.42, 0.05, 0, y0 - 0.015, 0, 0, y0, 0];
    const rot = flat([q(0, 0, 0), q(0, 0, 0), q(0.35, 0, 0), q(0.35, 0, 0), q(0, 0, 0), q(0, 0, 0)]);
    clips.push(new THREE.AnimationClip('Open', 1.6, [
      new THREE.VectorKeyframeTrack('CapTop.position', times, pos),
      new THREE.QuaternionKeyframeTrack('CapTop.quaternion', times, rot),
    ]));
  }
  return clips;
}

// ---------- optional illustration shading ----------
// Screen-space stipple like the source art: black specks in shadow, white specks in highlights.
// Viewer-only (a shader tweak), so it is not part of the GLB.
export const stippleUniforms = {
  uStipple: { value: 1 },
  uStippleSize: { value: 1.5 },
};

export function applyStipple(object) {
  object.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m.userData.stipple) return;
    m.userData.stipple = true;
    m.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, stippleUniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float uStipple;\nuniform float uStippleSize;\nvoid main() {')
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        if (uStipple > 0.0) {
          float l = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
          vec2 cell = floor(gl_FragCoord.xy / uStippleSize);
          float n = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
          float dark = smoothstep(0.32, 0.02, l) * 0.85 * uStipple;
          float lite = smoothstep(0.45, 0.95, l) * 0.7 * uStipple;
          if (n < dark) gl_FragColor.rgb *= 0.12;
          else if (n > 1.0 - lite) gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), 0.8);
        }`);
    };
    m.needsUpdate = true;
  });
}
