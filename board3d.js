'use strict';
/*
 * Mesa en 3D con Three.js.
 * Recibe las posiciones que calcula Board en game.js (en unidades: una ficha mide 2x1)
 * y las dibuja como fichas con volumen sobre un paño. El eje y de Board es el eje z del
 * mundo 3D, así que "arriba" en la pantalla es -z.
 */
window.Board3D = (() => {
  const T = window.THREE;
  const TILE_T = 0.32; // grosor de la ficha
  const GAP = 0.05; // separación visual entre fichas
  const ELEV = (60 * Math.PI) / 180; // inclinación de la cámara sobre la mesa
  const HOVER_Y = 1.1; // altura de la ficha mientras se arrastra

  // Igual que en game.js: posiciones de los puntos en una cuadrícula 3x3.
  const PIPS = {
    0: [],
    1: [[1, 1]],
    2: [[2, 0], [0, 2]],
    3: [[2, 0], [1, 1], [0, 2]],
    4: [[0, 0], [2, 0], [0, 2], [2, 2]],
    5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
    6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]],
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOut = (k) => 1 - (1 - k) ** 3;

  function supported() {
    try {
      const c = document.createElement('canvas');
      return !!(T && window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch {
      return false;
    }
  }

  /* ---------- Geometría y texturas ---------- */

  // Una sola geometría para todas las fichas: rectángulo redondeado con bisel,
  // acostado sobre la mesa, con la cara superior mapeada de 0 a 1.
  function makeTileGeometry() {
    const b = 0.05;
    const W = 2 - GAP - 2 * b;
    const H = 1 - GAP - 2 * b;
    const r = 0.1;
    const s = new T.Shape();
    s.moveTo(-W / 2 + r, -H / 2);
    s.lineTo(W / 2 - r, -H / 2);
    s.quadraticCurveTo(W / 2, -H / 2, W / 2, -H / 2 + r);
    s.lineTo(W / 2, H / 2 - r);
    s.quadraticCurveTo(W / 2, H / 2, W / 2 - r, H / 2);
    s.lineTo(-W / 2 + r, H / 2);
    s.quadraticCurveTo(-W / 2, H / 2, -W / 2, H / 2 - r);
    s.lineTo(-W / 2, -H / 2 + r);
    s.quadraticCurveTo(-W / 2, -H / 2, -W / 2 + r, -H / 2);
    const geo = new T.ExtrudeGeometry(s, {
      depth: TILE_T - 2 * b,
      bevelEnabled: true,
      bevelThickness: b,
      bevelSize: b,
      bevelSegments: 3,
      curveSegments: 5,
    });
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const FW = W + 2 * b;
    const FH = H + 2 * b;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (pos.getX(i) + FW / 2) / FW, (pos.getY(i) + FH / 2) / FH);
    }
    geo.rotateX(-Math.PI / 2);
    geo.computeBoundingBox();
    geo.translate(0, -geo.boundingBox.min.y, 0);
    return geo;
  }

  // Cara de la ficha en horizontal: "first" a la izquierda y "second" a la derecha.
  function drawFace(first, second) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const x = c.getContext('2d');
    const bg = x.createLinearGradient(0, 0, 0, 256);
    bg.addColorStop(0, '#fffdf6');
    bg.addColorStop(1, '#efe6cf');
    x.fillStyle = bg;
    x.fillRect(0, 0, 512, 256);

    x.strokeStyle = '#9d916f';
    x.lineWidth = 7;
    x.lineCap = 'round';
    x.beginPath();
    x.moveTo(256, 38);
    x.lineTo(256, 218);
    x.stroke();

    const pips = (n, ox) => {
      for (const [col, row] of PIPS[n]) {
        // En horizontal se intercambian filas y columnas (igual que en el SVG 2D).
        const px = ox + 62 + row * 66;
        const py = 62 + col * 66;
        const g = x.createRadialGradient(px - 4, py - 5, 2, px, py, 23);
        g.addColorStop(0, '#000');
        g.addColorStop(1, '#2b2b2b');
        x.fillStyle = g;
        x.beginPath();
        x.arc(px, py, 22, 0, Math.PI * 2);
        x.fill();
        // Brillo en el borde inferior: hace que el punto parezca hundido.
        x.strokeStyle = 'rgba(255,255,255,.55)';
        x.lineWidth = 3;
        x.beginPath();
        x.arc(px, py, 22, 0.15 * Math.PI, 0.85 * Math.PI);
        x.stroke();
      }
    };
    pips(first, 0);
    pips(second, 256);

    const pin = x.createRadialGradient(251, 123, 2, 256, 128, 14);
    pin.addColorStop(0, '#f6d983');
    pin.addColorStop(1, '#94722a');
    x.fillStyle = pin;
    x.beginPath();
    x.arc(256, 128, 13, 0, Math.PI * 2);
    x.fill();
    return c;
  }

  function feltCanvas() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#1e7149';
    x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) {
      const v = Math.random();
      x.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.09})` : `rgba(0,0,0,${v * 0.12})`;
      x.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 1.5, 1);
    }
    return c;
  }

  /* ---------- Vista ---------- */

  function create(container) {
    if (!supported()) return null;
    let renderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch {
      return null;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const canvas = renderer.domElement;
    canvas.className = 'board3d';
    container.prepend(canvas);

    const scene = new T.Scene();
    const bgColor = new T.Color('#0a3726');
    scene.background = bgColor;
    scene.fog = new T.Fog(bgColor, 28, 60);
    const camera = new T.PerspectiveCamera(36, 1, 0.1, 200);

    scene.add(new T.HemisphereLight('#fff6e0', '#0c3a26', 1.25));
    const sun = new T.DirectionalLight('#fff1d4', 2.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    scene.add(sun, sun.target);

    const felt = new T.CanvasTexture(feltCanvas());
    felt.wrapS = T.RepeatWrapping;
    felt.wrapT = T.RepeatWrapping;
    felt.repeat.set(40, 40);
    felt.colorSpace = T.SRGBColorSpace;
    const table = new T.Mesh(
      new T.PlaneGeometry(200, 200),
      new T.MeshStandardMaterial({ map: felt, roughness: 1, metalness: 0 }),
    );
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    scene.add(table);

    const geo = makeTileGeometry();
    const sideMat = new T.MeshStandardMaterial({ color: '#efe5cc', roughness: 0.42 });
    const faceMats = new Map();
    const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    function faceMat(first, second) {
      const key = `${first}${second}`;
      if (!faceMats.has(key)) {
        const tex = new T.CanvasTexture(drawFace(first, second));
        tex.colorSpace = T.SRGBColorSpace;
        tex.anisotropy = maxAniso;
        faceMats.set(key, new T.MeshStandardMaterial({ map: tex, roughness: 0.36 }));
      }
      return faceMats.get(key);
    }
    function newTileMesh(first, second) {
      const m = new T.Mesh(geo, [faceMat(first, second), sideMat]);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    }
    const rotFor = (p) => (p.vertical ? -Math.PI / 2 : 0);
    function placeMesh(mesh, p) {
      mesh.position.set(p.x + p.w / 2, 0, p.y + p.h / 2);
      mesh.rotation.set(0, rotFor(p), 0);
    }

    const tiles = []; // { mesh, key, plan, anim }
    let ghosts = []; // { side, mesh }
    let hover = null; // ficha que sigue al dedo
    let hoverGoal = null;
    let dirty = true;
    let snapCamera = true;

    /* ---------- Cámara ---------- */

    const view = { yaw: 0, zoom: 1 };
    const cam = { target: new T.Vector3(), dist: 14, yaw: 0 };
    const goal = { target: new T.Vector3(), dist: 14 };
    let box = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };

    function computeGoal() {
      const w0 = box.maxX - box.minX;
      const d0 = box.maxZ - box.minZ;
      const c = Math.abs(Math.cos(view.yaw));
      const s = Math.abs(Math.sin(view.yaw));
      const w = w0 * c + d0 * s;
      const d = w0 * s + d0 * c;
      const vf = (camera.fov * Math.PI) / 180;
      const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
      const byWidth = w / 2 / Math.tan(hf / 2) + (d / 2) * Math.cos(ELEV);
      const byDepth = (d * Math.sin(ELEV)) / 2 / Math.tan(vf / 2) + (d / 2) * Math.cos(ELEV) * 0.5;
      goal.target.set((box.minX + box.maxX) / 2, 0, (box.minZ + box.maxZ) / 2);
      goal.dist = Math.max(7, Math.max(byWidth, byDepth) * 1.06) / view.zoom;
      dirty = true;
    }

    function fit(rects) {
      let minX = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxZ = -Infinity;
      for (const r of rects) {
        minX = Math.min(minX, r.x);
        minZ = Math.min(minZ, r.y);
        maxX = Math.max(maxX, r.x + r.w);
        maxZ = Math.max(maxZ, r.y + r.h);
      }
      const pad = 0.5;
      box = { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
      computeGoal();
      const cx = (box.minX + box.maxX) / 2;
      const cz = (box.minZ + box.maxZ) / 2;
      const half = Math.max(box.maxX - box.minX, box.maxZ - box.minZ) / 2 + 4;
      Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
      sun.shadow.camera.updateProjectionMatrix();
      sun.position.set(cx - 7, 16, cz + 9);
      sun.target.position.set(cx, 0, cz);
    }

    function updateCamera(dt) {
      const k = snapCamera ? 1 : 1 - Math.exp(-dt * 7);
      snapCamera = false;
      cam.target.lerp(goal.target, k);
      cam.dist += (goal.dist - cam.dist) * k;
      cam.yaw += (view.yaw - cam.yaw) * k;
      const ce = Math.cos(ELEV);
      camera.position.set(
        cam.target.x + Math.sin(cam.yaw) * ce * cam.dist,
        cam.target.y + Math.sin(ELEV) * cam.dist,
        cam.target.z + Math.cos(cam.yaw) * ce * cam.dist,
      );
      camera.lookAt(cam.target);
      camera.updateMatrixWorld();
      return cam.target.distanceTo(goal.target) > 0.002
        || Math.abs(goal.dist - cam.dist) > 0.002
        || Math.abs(view.yaw - cam.yaw) > 0.0005;
    }

    /* ---------- Pantalla <-> mundo ---------- */

    const raycaster = new T.Raycaster();
    function rect() { return canvas.getBoundingClientRect(); }
    function toScreen(v) {
      const p = v.clone().project(camera);
      const r = rect();
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    }
    function fromScreen(x, y, height) {
      const r = rect();
      const ndc = new T.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const out = new T.Vector3();
      const hit = raycaster.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -height), out);
      return hit ? out : null;
    }

    /* ---------- Fichas de la mesa ---------- */

    function clearTiles() {
      for (const t of tiles) scene.remove(t.mesh);
      tiles.length = 0;
    }

    function sync(placed, rects) {
      if (placed.length < tiles.length) clearTiles();
      if (!placed.length) snapCamera = true;
      placed.forEach((p, i) => {
        const key = `${p.first}${p.second}${p.vertical ? 'v' : 'h'}`;
        let t = tiles[i];
        if (t && t.key !== key) {
          scene.remove(t.mesh);
          t = null;
        }
        if (!t) {
          const mesh = newTileMesh(p.first, p.second);
          scene.add(mesh);
          t = { mesh, key };
          tiles[i] = t;
        }
        t.plan = p;
        if (!t.anim) placeMesh(t.mesh, p);
      });
      fit(rects);
    }

    // Anima la última ficha desde donde venía (el dedo, la mano o el celular).
    function animateLast(from) {
      const t = tiles[tiles.length - 1];
      if (!t) return;
      const to = new T.Vector3(t.plan.x + t.plan.w / 2, 0, t.plan.y + t.plan.h / 2);
      const r1 = rotFor(t.plan);
      let start;
      let r0 = r1;
      if (from && from.world) {
        start = from.world.clone();
        r0 = from.rotY;
      } else if (from && from.screen) {
        const r = rect();
        start = fromScreen(from.screen.x, clamp(from.screen.y, r.top + 8, r.bottom - 8), 2.4);
        r0 = from.vertical ? -Math.PI / 2 : 0;
      }
      if (!start) start = to.clone().add(new T.Vector3(0, 2.4, 0));
      t.anim = { from: start, to, r0, r1, t0: performance.now(), dur: 430 };
      t.mesh.position.copy(start);
      t.mesh.rotation.set(0, r0, 0);
      dirty = true;
    }

    function stepAnimations(now) {
      let any = false;
      for (const t of tiles) {
        const a = t.anim;
        if (!a) continue;
        const k = clamp((now - a.t0) / a.dur, 0, 1);
        const e = easeOut(k);
        t.mesh.position.lerpVectors(a.from, a.to, e);
        t.mesh.position.y = a.from.y * (1 - e) + Math.sin(Math.PI * k) * 0.5;
        t.mesh.rotation.set((1 - e) * 0.35, a.r0 + (a.r1 - a.r0) * e, 0);
        if (k >= 1) {
          placeMesh(t.mesh, t.plan);
          t.anim = null;
        } else {
          any = true;
        }
      }
      return any;
    }

    /* ---------- Lugares donde cabe la ficha ---------- */

    function clearGhosts() {
      for (const gh of ghosts) scene.remove(gh.mesh);
      ghosts = [];
      dirty = true;
    }

    function showGhosts(list) {
      clearGhosts();
      for (const { side, plan } of list) {
        const mesh = new T.Mesh(geo, new T.MeshBasicMaterial({
          color: '#ffd166', transparent: true, opacity: 0.4, depthWrite: false,
        }));
        placeMesh(mesh, plan);
        mesh.scale.y = 0.12;
        mesh.position.y = 0.005;
        scene.add(mesh);
        ghosts.push({ side, mesh, plan, hot: false });
      }
    }

    function setHot(side) {
      for (const gh of ghosts) gh.hot = gh.side === side;
      dirty = true;
    }

    function nearestGhost(x, y, maxDist = Infinity) {
      let best = null;
      let bestD = maxDist;
      for (const gh of ghosts) {
        const s = toScreen(gh.mesh.position);
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < bestD) {
          bestD = d;
          best = gh.side;
        }
      }
      return best;
    }

    /* ---------- Ficha arrastrada ---------- */

    function hoverAt(t, x, y, side) {
      const gh = ghosts.find((g) => g.side === side);
      const first = gh ? gh.plan.first : t.a;
      const second = gh ? gh.plan.second : t.b;
      if (!hover) {
        hover = newTileMesh(first, second);
        scene.add(hover);
      }
      hover.material[0] = faceMat(first, second);
      const p = fromScreen(x, y, HOVER_Y);
      if (p) hover.position.set(p.x, HOVER_Y, p.z);
      hoverGoal = gh ? rotFor(gh.plan) : -Math.PI / 2;
      hover.visible = true;
      dirty = true;
    }

    function hoverHide() {
      if (hover) hover.visible = false;
      dirty = true;
    }

    // Quita la ficha arrastrada y devuelve dónde estaba, para animar desde ahí.
    function hoverEnd() {
      if (!hover) return null;
      const res = hover.visible ? { world: hover.position.clone(), rotY: hover.rotation.y } : null;
      scene.remove(hover);
      hover = null;
      dirty = true;
      return res;
    }

    /* ---------- Gestos: girar y acercar la mesa ---------- */

    const pointers = new Map();
    let pinch = null;
    let dragged = 0;
    canvas.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragged = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragged += Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
      if (pointers.size === 1) {
        view.yaw = clamp(view.yaw - (e.clientX - prev.x) * 0.006, -0.8, 0.8);
        computeGoal();
      } else if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        view.zoom = clamp((pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d, 0.7, 2.6);
        computeGoal();
      }
    });
    const release = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      view.zoom = clamp(view.zoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.7, 2.6);
      computeGoal();
    }, { passive: false });
    canvas.addEventListener('dblclick', () => {
      view.yaw = 0;
      view.zoom = 1;
      computeGoal();
    });

    /* ---------- Bucle de dibujo ---------- */

    // Solo se redibuja cuando algo cambia, para no gastar batería.
    let last = performance.now();
    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (document.hidden) return;
      let active = updateCamera(dt);
      if (stepAnimations(now)) active = true;
      if (ghosts.length) {
        const pulse = 0.32 + 0.12 * Math.sin(now / 160);
        for (const gh of ghosts) gh.mesh.material.opacity = gh.hot ? 0.85 : pulse;
        active = true;
      }
      if (hover && hover.visible && hoverGoal !== null) {
        hover.rotation.y += (hoverGoal - hover.rotation.y) * (1 - Math.exp(-dt * 14));
        hover.rotation.x = 0.12;
        active = true;
      }
      if (active || dirty) {
        renderer.render(scene, camera);
        dirty = false;
      }
    }

    function resize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      computeGoal();
    }

    resize();
    requestAnimationFrame(frame);

    return {
      sync,
      animateLast,
      showGhosts,
      clearGhosts,
      setHot,
      nearestGhost,
      hoverAt,
      hoverHide,
      hoverEnd,
      resize,
      // true si el último gesto sobre la mesa fue arrastrar (girar) y no un toque.
      wasDragged: () => dragged > 8,
    };
  }

  return { create };
})();
