// Procedural "Moments" 35mm film cartridge (patrone) with a pull-out film strip.
// Units: 1 = cartridge diameter (25 mm; overall length with caps ≈ 47.5 mm). The cartridge axis is local +Y (plain end up, spool end down).
// Node tree (names are kept in the exported GLB so animation tools can target them):
//   FilmCanister            ← place / pose / float this
//     Spin                  ← rotate around Y to roll the label
//       Label               ← printed wrap (assets/label.jpg)
//       Lip                 ← light-trap slot the film comes out of
//       Film                ← film strip; pulled out by setFilmOut() (runtime) or morph targets (GLB)
//       CapTop              ← plain end cap (slides off in the "Open" clip)
//       CapSpool            ← end cap with the spool hub
import * as THREE from 'three';

export const DIM = {
  radius: 0.5,       // label radius
  length: 1.48,      // label length between the caps → 1.88 overall with caps, like a real 25 × 47 mm cartridge
  capRadius: 0.535,  // outer radius of the metal caps
  capHeight: 0.2,
};

// 35mm film, written in millimetres and converted to model units (1 = 25 mm).
// Frames are 36×24 mm on a 38 mm pitch with 8 perforations per frame.
// Everything along the strip is measured from the leader tip.
const mm = v => v / 25;
export const FILM = {
  width: mm(35),
  leader: mm(22),       // tongue + taper + a little blank film before frame 1
  tongue: mm(10),       // half-width part of the leader
  taper: mm(8),         // curved cut from half to full width
  pitch: mm(38),
  frameW: mm(36),
  frameH: mm(24),
  perfPitch: mm(4.75),
  perfAlong: mm(1.98),
  perfAcross: mm(2.79),
  perfEdge: mm(2),      // film edge → perforation
  frames: 6,
  curl: 0.12,           // the strip bends gently toward the viewer as it comes out
  pxPerUnit: 230,
};
FILM.length = FILM.leader + FILM.frames * FILM.pitch;
// How far the "Pull" animation draws the film out: the leader plus two full frames.
FILM.pullOut = FILM.leader + 2.05 * FILM.pitch;

export const COLORS = {
  metal: '#141418',
  filmBase: '#0e0d0c',      // positive strip
  edgePrint: '#f0a640',
};

const asset = name => new URL(`./assets/${name}`, import.meta.url).href;
export const DEFAULT_LABEL = asset('label.jpg');
export const DEFAULT_FRAMES = [asset('frame-1.jpg'), asset('frame-2.jpg'), asset('frame-3.jpg')];

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

// Accepts a URL or anything drawImage takes (img, canvas, ImageBitmap, video frame…).
export function loadImage(src) {
  if (typeof src !== 'string') return Promise.resolve(src);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image: ${src}`));
    img.src = src;
  });
}

const sizeOf = img => [img.naturalWidth || img.videoWidth || img.width, img.naturalHeight || img.videoHeight || img.height];

// ---------- label ----------
// Canvas U wraps the circumference, V runs along the axis (canvas top = CapTop end).
// The artwork's width spans the label length, so "Moments" reads from the CapTop end to the spool end.
// The whole artwork is used and repeated around the can until the wrap is filled
// (its top and bottom edges are both blue, so the repeats meet cleanly). The wrap's own seam sits under the Lip.
const LABEL_FOCUS = 0.27; // fraction of the artwork's height that faces the camera (between title and copy)

export function drawLabel(canvas, img) {
  const H = canvas.height, W = canvas.width;
  const ctx = canvas.getContext('2d');
  const [iw, ih] = sizeOf(img);
  const scale = H / iw;            // artwork width → label length
  const th = ih * scale;           // artwork height in canvas px (around the circumference)
  ctx.save();
  ctx.translate(W / 2, 0);
  ctx.rotate(Math.PI / 2);         // art +x → down the axis; art up → canvas +x
  // in this frame: x ∈ [0, H] along the axis, y runs around the can (y = 0 faces the camera)
  const y0 = -LABEL_FOCUS * th;
  const first = Math.floor((-W / 2 - y0) / th), last = Math.ceil((W / 2 - y0) / th);
  for (let k = first; k <= last; k++) ctx.drawImage(img, 0, y0 + k * th - (k ? 0.5 : 0), H, th + 1);
  ctx.drawImage(img, 0, y0, H, th); // keep the facing copy on top of its neighbours' overlap
  ctx.restore();
}

function makeLabelTexture(width = 3072) {
  const W = width;
  const H = Math.round(W * DIM.length / (Math.PI * 2 * DIM.radius));
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2b4cf0';       // placeholder until the artwork loads
  ctx.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData.mimeType = 'image/jpeg'; // keeps the exported GLB small
  return tex;
}

// ---------- film strip texture ----------
// Canvas x = distance from the leader tip (u = s / FILM.length), canvas top = the CapTop side of the strip.
// Frame i (0-based) occupies s ∈ [frameStart(i), frameStart(i) + frameW] and the middle frameH of the width.
export const frameStart = i => FILM.leader + i * FILM.pitch + (FILM.pitch - FILM.frameW) / 2;

export function frameRectUV(i) {
  return {
    u0: frameStart(i) / FILM.length,
    u1: (frameStart(i) + FILM.frameW) / FILM.length,
    v0: (FILM.width - FILM.frameH) / 2 / FILM.width,
    v1: (FILM.width + FILM.frameH) / 2 / FILM.width,
  };
}

function filmOutline(ctx, P, H) {
  const tongueEnd = FILM.tongue * P, taper = FILM.taper * P, half = H / 2, r = 0.06 * P;
  ctx.beginPath();
  ctx.moveTo(0, half + r);
  ctx.quadraticCurveTo(0, half, r, half);
  ctx.lineTo(tongueEnd, half);
  ctx.bezierCurveTo(tongueEnd + taper * 0.55, half, tongueEnd + taper * 0.45, 0, tongueEnd + taper, 0);
  ctx.lineTo(FILM.length * P, 0);
  ctx.lineTo(FILM.length * P, H);
  ctx.lineTo(r, H);
  ctx.quadraticCurveTo(0, H, 0, H - r);
  ctx.closePath();
}

// The endless strip used by the Feed loop: no leader, one frame per image, tiles seamlessly along U.
export const feedFrameStart = i => i * FILM.pitch + (FILM.pitch - FILM.frameW) / 2;
export const feedCycle = imageCount => Math.min(Math.max(imageCount, 1), 12) * FILM.pitch;

// images: array of loaded image sources; they repeat if there are fewer than FILM.frames.
// fit: 'auto' turns portrait shots sideways (as they sit on real film), 'cover' always crops upright.
// loop: draw the endless Feed strip instead (canvas width must be feedCycle(images.length) long).
export function drawFilmStrip(canvas, images = [], { fit = 'auto', loop = false, label = 'MOMENTS 400' } = {}) {
  const P = FILM.pxPerUnit, W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const count = loop ? Math.round(W / (FILM.pitch * P)) : FILM.frames;
  const start = loop ? feedFrameStart : frameStart;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (loop) { ctx.beginPath(); ctx.rect(0, 0, W, H); } else filmOutline(ctx, P, H);
  ctx.fillStyle = COLORS.filmBase;
  ctx.fill();
  ctx.clip();

  // Frames
  const fw = FILM.frameW * P, fh = FILM.frameH * P, fy = (H - fh) / 2;
  for (let i = 0; i < count; i++) {
    const fx = start(i) * P;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(fx, fy, fw, fh, 0.03 * P);
    ctx.clip();
    ctx.fillStyle = '#1c1a18';
    ctx.fillRect(fx, fy, fw, fh);
    const img = images.length ? images[i % images.length] : null;
    if (img) {
      const [iw, ih] = sizeOf(img);
      const sideways = fit === 'auto' && ih > iw;
      ctx.save();
      ctx.translate(fx + fw / 2, fy + fh / 2);
      if (sideways) ctx.rotate(Math.PI / 2); // photo "up" points toward the cartridge
      const bw = sideways ? fh : fw, bh = sideways ? fw : fh;
      const s = Math.max(bw / iw, bh / ih);
      ctx.drawImage(img, -iw * s / 2, -ih * s / 2, iw * s, ih * s);
      ctx.restore();
    }
    ctx.restore();
  }

  // Edge printing between the perforations and the edge (both sides, like real stock)
  ctx.fillStyle = COLORS.edgePrint;
  ctx.font = `500 ${Math.round(0.06 * P)}px "JetBrains Mono", ui-monospace, Menlo, monospace`;
  ctx.textBaseline = 'middle';
  const topY = (FILM.perfEdge / 2) * P, botY = H - topY;
  for (let i = 0; i < count; i++) {
    const fx = start(i) * P;
    ctx.fillText(`${label}`, fx + 0.1 * P, botY);
    ctx.fillText(`▸ ${i + 1}`, fx + 0.1 * P, topY);
    ctx.fillText(`${i + 1}A`, fx + FILM.pitch * 0.55 * P, topY);
  }
  ctx.restore();

  // Perforations, punched out of the alpha
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const pw = FILM.perfAlong * P, ph = FILM.perfAcross * P, pr = 0.018 * P;
  const rows = [FILM.perfEdge * P, H - FILM.perfEdge * P - ph];
  // 8 perforations per frame pitch, so the loop strip repeats cleanly
  const first = loop ? (FILM.perfPitch - FILM.perfAlong) / 2 : 0.2, end = W / P - (loop ? 0 : 0.1);
  for (let s = first; s < end; s += FILM.perfPitch) {
    for (const [ri, y] of rows.entries()) {
      if (!loop && s < FILM.tongue + FILM.taper && ri === 0) continue; // the cut-away half of the leader has no perfs
      ctx.beginPath();
      ctx.roundRect(s * P, y, pw, ph, pr);
      ctx.fill();
    }
  }
  ctx.restore();
}

function makeFilmTexture(length = FILM.length, loop = false) {
  const c = makeCanvas(Math.round(length * FILM.pxPerUnit), Math.round(FILM.width * FILM.pxPerUnit));
  drawFilmStrip(c, [], { loop });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (loop) tex.wrapS = THREE.RepeatWrapping;
  tex.userData.mimeType = 'image/png'; // needs alpha for the perforations
  return tex;
}

// ---------- film strip geometry ----------
// The strip leaves the slot at SLIT heading along -X and curls gently toward +Z (the camera side).
// A point `d` units out from the slot is a circular arc of curvature FILM.curl.
const SLIT = new THREE.Vector3(-0.2, 0, -DIM.radius - 0.03);
const SEG_ALONG = 220;

function filmPoint(d, outPos, outNormal) {
  const k = FILM.curl, dd = Math.max(d, 0), a = k * dd;
  outPos.set(SLIT.x - Math.sin(a) / k, 0, SLIT.z + (1 - Math.cos(a)) / k);
  // tangent T = (-cos a, 0, sin a); normal = Y × T faces the camera
  outNormal.set(Math.sin(a), 0, Math.cos(a));
}

// Fills position/normal arrays for the strip pulled `out` units out of the slot.
function writeFilm(out, pos, nrm) {
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i <= SEG_ALONG; i++) {
    const s = (i / SEG_ALONG) * FILM.length;
    filmPoint(out - s, p, n);
    for (let j = 0; j <= 1; j++) {
      const k = (i * 2 + j) * 3;
      pos[k] = p.x; pos[k + 1] = (j - 0.5) * FILM.width; pos[k + 2] = p.z;
      nrm[k] = n.x; nrm[k + 1] = 0; nrm[k + 2] = n.z;
    }
  }
}

// ---- Feed loop ----
// An endless strip streaming out of the slot. Its far end sits FEED_REACH units out (well off-screen),
// and it carries one extra cycle of film inside the cartridge. Feeding by one full cycle lands on an
// identical picture (the texture repeats every cycle), so the motion loops without a seam.
export const FEED_REACH = 9;
export const FEED_SECONDS_PER_FRAME = 0.9;
const FEED_SEG_PER_UNIT = 22;

function feedSegments(cycle) { return Math.ceil((FEED_REACH + cycle) * FEED_SEG_PER_UNIT); }

// fed: how much film has been pulled through, in units (any value; it wraps every cycle). null hides the strip.
function writeFeed(fed, cycle, pos, nrm) {
  const seg = feedSegments(cycle), len = FEED_REACH + cycle;
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const phase = fed == null ? -len : ((fed % cycle) + cycle) % cycle;
  for (let i = 0; i <= seg; i++) {
    const s = (i / seg) * len;               // from the far end toward the cartridge
    filmPoint(fed == null ? -1 : FEED_REACH + phase - s, p, n);
    for (let j = 0; j <= 1; j++) {
      const k = (i * 2 + j) * 3;
      pos[k] = p.x; pos[k + 1] = (j - 0.5) * FILM.width; pos[k + 2] = p.z;
      nrm[k] = n.x; nrm[k + 1] = 0; nrm[k + 2] = n.z;
    }
  }
}

function makeFilmGeometry(seg = SEG_ALONG, uLength = 1) {
  const count = (seg + 1) * 2;
  const g = new THREE.BufferGeometry();
  const uv = new Float32Array(count * 2), idx = [];
  for (let i = 0; i <= seg; i++) {
    for (let j = 0; j <= 1; j++) { uv[(i * 2 + j) * 2] = (i / seg) * uLength; uv[(i * 2 + j) * 2 + 1] = j; }
    if (i < seg) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Light-trap lip: a short tangential spout on the back of the shell, running the full label length.
function makeLipGeometry() {
  const r = DIM.radius;
  const s = new THREE.Shape();
  s.moveTo(0.12, -Math.sqrt(r * r - 0.12 * 0.12));
  s.lineTo(0.0, -r - 0.07);
  s.lineTo(-0.2, -r - 0.065);
  s.lineTo(-0.2, -r + 0.005);
  s.lineTo(-0.16, -Math.sqrt(r * r - 0.16 * 0.16));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: DIM.length - 0.02, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.012, bevelSegments: 3, curveSegments: 4,
  });
  g.rotateX(Math.PI / 2);                 // shape plane → XZ, extrusion → -Y
  g.translate(0, DIM.length / 2 - 0.01, 0);
  return g;
}

// Pull timing shared by the viewer and the GLB clip: the leader pops out, a beat, then a smooth draw.
export const PULL_DURATION = 2.2;
export function pullCurve(t) {
  const lead = FILM.leader * 0.95; // just the leader first
  if (t <= 0) return 0;
  if (t < 0.7) return lead * (1 - (1 - t / 0.7) ** 3);
  if (t < 0.85) return lead;
  const u = Math.min((t - 0.85) / (PULL_DURATION - 0.85), 1);
  const e = u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
  return lead + (FILM.pullOut - lead) * e;
}

// ---------- model ----------
// options:
//   label   URL or image for the wrap (defaults to assets/label.jpg)
//   frames  URLs or images for the film frames (defaults to the sample photos); repeats to fill FILM.frames
//   fit     'auto' | 'cover'  (see drawFilmStrip)
//   filmOut initial length of film outside the cartridge
// Returns the root Group. Its userData holds the runtime API:
//   ready                 Promise that resolves once label + frames are drawn
//   setFilmOut(units)     pull the film out (0 … FILM.length); FILM.pullOut is a good "fully out"
//   setFilmFeed(units)    endless Feed loop: units of film pulled through (wraps every feedCycle); null hides it
//   feedCycle             film length of one loop (one frame per image)
//   setFrames(list, opt)  redraw the frames with new images (opt: { fit }) → Promise
//   setLabel(src)         swap the wrap artwork → Promise
export function createFilmCanister({ label = DEFAULT_LABEL, frames = DEFAULT_FRAMES, fit = 'auto', filmOut = 0 } = {}) {
  const root = new THREE.Group();
  root.name = 'FilmCanister';
  const spin = new THREE.Group();
  spin.name = 'Spin';
  root.add(spin);

  const labelTex = makeLabelTexture();
  const labelMat = new THREE.MeshPhysicalMaterial({
    name: 'LabelPrint', map: labelTex, roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.35,
  });
  const labelMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(DIM.radius, DIM.radius, DIM.length, 128, 1, true),
    labelMat,
  );
  labelMesh.name = 'Label';
  // CylinderGeometry puts u = 0.5 at -Z; turn it so the art's centre faces +Z and the seam sits under the Lip
  labelMesh.rotation.y = Math.PI;
  spin.add(labelMesh);

  const metal = new THREE.MeshStandardMaterial({ name: 'BlackMetal', color: COLORS.metal, metalness: 0.55, roughness: 0.58 });

  const lip = new THREE.Mesh(makeLipGeometry(), metal);
  lip.name = 'Lip';
  spin.add(lip);
  const felt = new THREE.Mesh(
    new THREE.PlaneGeometry(0.075, DIM.length - 0.04),
    new THREE.MeshStandardMaterial({ name: 'Felt', color: '#0a0a0c', roughness: 1 }),
  );
  felt.name = 'LipFelt';
  felt.rotation.y = -Math.PI / 2;
  felt.position.set(-0.213, 0, -DIM.radius - 0.03);
  spin.add(felt);

  const filmTex = makeFilmTexture();
  const filmMat = new THREE.MeshStandardMaterial({
    name: 'FilmStrip', map: filmTex, emissiveMap: filmTex, emissive: '#ffffff', emissiveIntensity: 0.28,
    roughness: 0.32, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5,
  });
  const filmGeo = makeFilmGeometry();
  const film = new THREE.Mesh(filmGeo, filmMat);
  film.name = 'Film';
  film.frustumCulled = false; // geometry changes every frame
  spin.add(film);

  // Feed strip: same look, its own repeating texture and geometry (rebuilt when the image count changes)
  const feedMat = filmMat.clone();
  feedMat.map = feedMat.emissiveMap = null; // gets its own repeating texture in setFrames
  feedMat.name = 'FilmFeedStrip';
  const feed = new THREE.Mesh(new THREE.BufferGeometry(), feedMat);
  feed.name = 'FilmFeed';
  feed.frustumCulled = false;
  feed.visible = false;
  feed.castShadow = feed.receiveShadow = true;
  spin.add(feed);

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

  // ---- runtime API ----
  let out = -1;
  const setFilmOut = units => {
    units = THREE.MathUtils.clamp(units, 0, FILM.length);
    if (units === out) return;
    out = units;
    writeFilm(units, filmGeo.attributes.position.array, filmGeo.attributes.normal.array);
    filmGeo.attributes.position.needsUpdate = true;
    filmGeo.attributes.normal.needsUpdate = true;
    film.visible = units > 0.001;
  };
  let cycle = 0, fed = null;
  const setFilmFeed = units => {
    fed = units;
    feed.visible = units != null;
    if (!cycle) return;
    const g = feed.geometry;
    writeFeed(units, cycle, g.attributes.position.array, g.attributes.normal.array);
    g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = true;
  };
  const stripOpts = { fit };
  const setFrames = async (list, opt) => {
    Object.assign(stripOpts, opt); // fit sticks for later calls
    const imgs = await Promise.all(list.map(loadImage));
    drawFilmStrip(filmTex.image, imgs, stripOpts);
    filmTex.needsUpdate = true;
    // Feed: one frame per image, so its texture and geometry depend on the image count
    const c = feedCycle(imgs.length);
    if (c !== cycle) {
      cycle = c;
      feedMat.map?.dispose();
      feedMat.map = feedMat.emissiveMap = makeFilmTexture(cycle, true);
      feed.geometry.dispose();
      feed.geometry = makeFilmGeometry(feedSegments(cycle), (FEED_REACH + cycle) / cycle);
    }
    drawFilmStrip(feedMat.map.image, imgs.slice(0, Math.round(cycle / FILM.pitch)), { ...stripOpts, loop: true });
    feedMat.map.needsUpdate = true;
    setFilmFeed(fed);
  };
  const setLabel = async src => {
    drawLabel(labelTex.image, await loadImage(src));
    labelTex.needsUpdate = true;
  };
  setFilmOut(filmOut);
  root.userData = {
    setFilmOut, setFilmFeed, setFrames, setLabel,
    get filmOut() { return out; },
    get feedCycle() { return cycle; },
    ready: Promise.all([setLabel(label), setFrames(frames)]),
  };
  return root;
}

// Bakes the pull into morph targets so the GLB can play it without code:
// target i = film pulled out to PULL_STATES[i]. Weight two neighbours to land in between.
export const PULL_STATES = Array.from({ length: 17 }, (_, i) => (i / 16) * FILM.pullOut);

export function bakeFilmMorphs(root) {
  const film = root.getObjectByName('Film');
  const g = film.geometry;
  const n = g.attributes.position.count * 3;
  writeFilm(0, g.attributes.position.array, g.attributes.normal.array);
  g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = true;
  g.morphAttributes.position = [];
  g.morphAttributes.normal = [];
  for (const e of PULL_STATES) {
    const p = new Float32Array(n), nn = new Float32Array(n);
    writeFilm(e, p, nn);
    g.morphAttributes.position.push(new THREE.BufferAttribute(p, 3));
    g.morphAttributes.normal.push(new THREE.BufferAttribute(nn, 3));
  }
  g.morphTargetsRelative = false;
  film.visible = true;
  film.updateMorphTargets();

  // Feed: base = hidden inside the slot, target j = fed by j/K of a cycle (target K looks like target 0)
  const feed = root.getObjectByName('FilmFeed');
  const cycle = root.userData.feedCycle;
  const fg = feed.geometry, fn = fg.attributes.position.count * 3;
  writeFeed(null, cycle, fg.attributes.position.array, fg.attributes.normal.array);
  fg.attributes.position.needsUpdate = fg.attributes.normal.needsUpdate = true;
  fg.morphAttributes.position = [];
  fg.morphAttributes.normal = [];
  const K = Math.ceil(cycle / 0.5);
  for (let j = 0; j <= K; j++) {
    const p = new Float32Array(fn), nn = new Float32Array(fn);
    writeFeed((j / K) * cycle, cycle, p, nn);
    fg.morphAttributes.position.push(new THREE.BufferAttribute(p, 3));
    fg.morphAttributes.normal.push(new THREE.BufferAttribute(nn, 3));
  }
  fg.morphTargetsRelative = false;
  feed.visible = true;
  feed.updateMorphTargets();
  feed.userData = { feedCycle: cycle, states: K + 1 };
  return film;
}

function morphWeightsAt(e) {
  const w = new Array(PULL_STATES.length).fill(0);
  const step = PULL_STATES[1];
  const f = Math.min(e / step, PULL_STATES.length - 1);
  const i = Math.floor(f), t = f - i;
  w[i] = 1 - t;
  if (t > 0) w[i + 1] = t;
  return w;
}

// The pose of the illustration: axis tipped down to the lower-right, spool end toward the viewer.
// Built from directions so it is easy to tweak: where the spool end points, and where the label should face.
function heroRotation() {
  const toSpool = new THREE.Vector3(0.78, -0.42, 0.5).normalize();  // right, down, toward the viewer
  const y = toSpool.clone().negate();                                // local +Y = plain end
  const view = new THREE.Vector3(-0.1, 0.35, 1);                     // label faces the camera, a touch upward
  const z = view.sub(y.clone().multiplyScalar(view.dot(y))).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z), 'XYZ');
}
export const HERO_POSE = { rotation: heroRotation() };

// Turntable: hero pose turned by +angle about world +Y (positive = counter-clockwise when viewed from above).
export const TURNTABLE_DURATION = 4;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
export function turntableQuaternion(t, out = new THREE.Quaternion()) {
  const angle = (t / TURNTABLE_DURATION) * Math.PI * 2;
  return out.setFromEuler(HERO_POSE.rotation).premultiply(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, angle));
}

// ---------- baked clips (exported into the GLB) ----------
// Times in seconds. Idle, Spin and Feed loop; Open and Pull are one-shots (play Pull reversed to rewind).
// Pass the baked model to include Feed (its length depends on how many frame images it was built with).
export function createClips(model) {
  const clips = [];
  const q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
  const flat = qs => qs.flatMap(qq => qq.toArray());

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

  // Turntable: the whole posed cartridge turns 360° counter-clockwise (seen from above) around the world Y axis
  {
    const n = 17, dur = TURNTABLE_DURATION, times = [], rot = [];
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * dur;
      times.push(t);
      rot.push(turntableQuaternion(t));
    }
    clips.push(new THREE.AnimationClip('Turntable', dur, [
      new THREE.QuaternionKeyframeTrack('FilmCanister.quaternion', times, flat(rot)),
    ]));
  }

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

  {
    const n = 45, times = [], weights = [];
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * PULL_DURATION;
      times.push(t);
      weights.push(...morphWeightsAt(pullCurve(t)));
    }
    clips.push(new THREE.AnimationClip('Pull', PULL_DURATION, [
      new THREE.NumberKeyframeTrack('Film.morphTargetInfluences', times, weights),
    ]));
  }

  const feed = model?.getObjectByName('FilmFeed');
  if (feed?.userData.states) {
    const { feedCycle: cycle, states } = feed.userData;
    const dur = (cycle / FILM.pitch) * FEED_SECONDS_PER_FRAME, times = [], weights = [];
    for (let j = 0; j < states; j++) {
      times.push((j / (states - 1)) * dur);
      weights.push(...Array.from({ length: states }, (_, k) => (k === j ? 1 : 0)));
    }
    clips.push(new THREE.AnimationClip('Feed', dur, [
      new THREE.NumberKeyframeTrack('FilmFeed.morphTargetInfluences', times, weights),
    ]));
  }
  return clips;
}
