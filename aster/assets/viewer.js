/* ASTER interactive viewer — the Motion Lab look in one embeddable scene.
   One instance loads any case pack (assets/cases/<id>.js) and, for robots, the shared model (assets/models/<name>.js):
     * URDF links in the lab's original materials (or soft gray / flat gray), studio environment light, ACES tone mapping
     * Blender actor snapshots (start / middle / end), first-frame RGB point clouds
     * the point flow as in the supplementary film: bold Turbo tracks by starting height, drawn over the next flowAhead frames (the motion still to come)
     * source cameras as blue pose glyphs with a sampled trail, and a distance-faded world grid with X / Y / Z axes
   Drag to orbit, right- or shift-drag to pan, scroll (after clicking in) or pinch to zoom, double-click to reset.
   Time is driven from outside (setTime), so a video and the 3D view can share one clock. */
(function (root) {
  'use strict';
  const T = root.THREE;
  const DIR = {case: 'assets/cases/', model: 'assets/models/'};

  // ---------------------------------------------------------------- loading (script tags: works from file://)
  const store = {case: {}, model: {}}, waiting = {case: {}, model: {}};
  const arrive = (kind, id, data) => {store[kind][id] = data; (waiting[kind][id] || []).forEach(f => f(data)); delete waiting[kind][id];};
  const fetchScript = (kind, id) => store[kind][id] ? Promise.resolve(store[kind][id]) : new Promise((resolve, reject) => {
    const first = !waiting[kind][id]; (waiting[kind][id] = waiting[kind][id] || []).push(resolve); if (!first) return;
    const s = document.createElement('script'); s.src = DIR[kind] + id + '.js'; s.async = true;
    s.onerror = () => reject(new Error(`missing ${kind} ${id}`)); document.head.appendChild(s);
  });
  root.ASTER_VIEWER = {
    register: (id, pack) => arrive('case', id, pack), registerModel: (id, model) => arrive('model', id, model),
    load: id => fetchScript('case', id), loadModel: id => fetchScript('model', id),
  };

  // ---------------------------------------------------------------- decoding
  const bytes = b64 => {const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer;};
  function dequant(block) {  // int16 over [lo, hi]; -32768 = missing
    const q = new Int16Array(bytes(block.q)), out = new Float32Array(q.length), lo = block.lo, sp = block.hi.map((h, k) => h - lo[k]);
    for (let i = 0; i < q.length; i++) {const k = i % 3; out[i] = q[i] === -32768 ? NaN : lo[k] + (q[i] + 32767) / 65534 * sp[k];}
    return out;
  }
  function partGeometry(m) {  // uint16 positions over [lo, hi], int8 creased normals, uint16/32 indices
    const q = new Uint16Array(bytes(m.q)), pos = new Float32Array(q.length), lo = m.lo, sp = m.hi.map((h, k) => h - lo[k]);
    for (let i = 0; i < q.length; i++) {const k = i % 3; pos[i] = lo[k] + q[i] / 65535 * sp[k];}
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setIndex(new T.BufferAttribute(m.wide ? new Uint32Array(bytes(m.idx)) : new Uint16Array(bytes(m.idx)), 1));
    if (m.n) g.setAttribute('normal', new T.BufferAttribute(new Int8Array(bytes(m.n)), 3, true)); else g.computeVertexNormals();
    return g;
  }
  const xfMatrix = (x, o, m = new T.Matrix4()) => m.set(x[o], x[o + 1], x[o + 2], x[o + 3], x[o + 4], x[o + 5], x[o + 6], x[o + 7], x[o + 8], x[o + 9], x[o + 10], x[o + 11], 0, 0, 0, 1);
  const turbo = t => {
    t = Math.min(1, Math.max(0, t));
    const r = .1357 + t * (4.5974 - t * (42.3277 - t * (130.5887 - t * (150.5666 - t * 58.1375))));
    const g = .0914 + t * (2.1856 + t * (4.8052 - t * (14.0195 - t * (4.2109 + t * 2.7747))));
    const b = .1067 + t * (12.5925 - t * (60.1097 - t * (109.0745 - t * (88.5066 - t * 26.8183))));
    return new T.Color().setRGB(Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b)), T.SRGBColorSpace);
  };
  const srgb = hex => new T.Color(hex);   // hex is sRGB; THREE stores linear

  // ---------------------------------------------------------------- shaders (all write linear -> output colour space)
  // Screen-space ribbons: width in device px. The flow is the action: with uFuture it is drawn from uFrame over a fixed
  // window ahead, and the mesh then moves along it. Time is mirrored for it, so taper and fade run from the head forward.
  const RIBBON_VS = `attribute vec3 a; attribute vec3 b; attribute float t; attribute float side; attribute float fa; attribute vec4 tint;
    uniform vec2 uRes; uniform float uWidth, uTaper, uFuture; varying vec4 vTint; varying float vF;
    void main() {
      vec4 ca = projectionMatrix * modelViewMatrix * vec4(a, 1.), cb = projectionMatrix * modelViewMatrix * vec4(b, 1.);
      vec2 d = (cb.xy / cb.w - ca.xy / ca.w) * uRes; d = length(d) > 1e-6 ? normalize(d) : vec2(1., 0.);
      float g = uFuture > .5 ? 1. - fa : fa;
      vec4 c = mix(ca, cb, t); float w = uWidth * mix(1., 0.7 + 0.3 * g, uTaper);
      c.xy += vec2(-d.y, d.x) * side * w / uRes * c.w; gl_Position = c; vTint = tint; vF = g;
    }`;
  // The flow fades with distance from the head, as in the lab (flowAlphaStart -> flowAlphaEnd): the next motion reads
  // boldest and the far future stays translucent, so a solid mesh moving inside its own flow is still visible.
  const ribbonMaterial = ({width, taper = 0, timed = false, future = false, depth = false, transparent = false, fade = null}) => new T.ShaderMaterial({
    uniforms: {uRes: {value: new T.Vector2(1, 1)}, uWidth: {value: width}, uBase: {value: width}, uTaper: {value: taper},
      uFrame: {value: timed ? 0 : 2}, uFade: {value: new T.Vector2(fade ? fade[0] : 1, fade ? fade[1] : 1)}, uTrail: {value: 0}, uFuture: {value: future ? 1 : 0}},
    depthTest: depth, depthWrite: false, transparent: transparent || !!fade, side: T.DoubleSide, vertexShader: RIBBON_VS,
    fragmentShader: `uniform float uFrame, uTrail, uFuture; uniform vec2 uFade; varying vec4 vTint; varying float vF;
      void main() { float now = uFuture > .5 ? 1. - uFrame : uFrame; if (vF > now + 1e-4) discard;
        // uTrail > 0 keeps only a window of motion. Ahead of the head the window has a fixed length and fade, so near the
        // end of the clip it is cut short rather than squeezed.
        float span = uTrail > 0. ? (uFuture > .5 ? uTrail : min(uTrail, now)) : now;
        if (uTrail > 0. && vF < now - uTrail) discard;
        float age = clamp(1. - (now - vF) / max(span, 1e-4), 0., 1.);
        gl_FragColor = vec4(vTint.rgb, vTint.a * mix(uFade.x, uFade.y, age));
      #include <colorspace_fragment>
      }`,
  });
  function ribbons(segs, mat) {  // segs: [{a, b, c: Color, al: [alpha_a, alpha_b], f: [fa, fb]}]
    const A = [], B = [], tt = [], side = [], fa = [], tint = [], idx = [];
    for (const s of segs) {
      const v = A.length / 3, al = s.al || [1, 1], f = s.f || [0, 0];
      for (const [t, sd] of [[0, -1], [0, 1], [1, -1], [1, 1]]) {A.push(...s.a); B.push(...s.b); tt.push(t); side.push(sd); fa.push(f[t]); tint.push(s.c.r, s.c.g, s.c.b, al[t]);}
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(A, 3)); g.setAttribute('a', new T.Float32BufferAttribute(A, 3)); g.setAttribute('b', new T.Float32BufferAttribute(B, 3));
    g.setAttribute('t', new T.Float32BufferAttribute(tt, 1)); g.setAttribute('side', new T.Float32BufferAttribute(side, 1));
    g.setAttribute('fa', new T.Float32BufferAttribute(fa, 1)); g.setAttribute('tint', new T.Float32BufferAttribute(tint, 4)); g.setIndex(idx);
    const m = new T.Mesh(g, mat); m.frustumCulled = false; return m;
  }
  const dotMaterial = () => new T.ShaderMaterial({
    uniforms: {uSize: {value: 9}}, depthTest: false, depthWrite: false,
    vertexShader: `attribute vec3 tint; attribute float on; uniform float uSize; varying vec3 vTint; varying float vOn;
      void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_PointSize = uSize * on; vTint = tint; vOn = on; }`,
    fragmentShader: `varying vec3 vTint; varying float vOn; void main() { if (vOn < .5) discard; vec2 p = gl_PointCoord - .5; float r = length(p);
      if (r > .5) discard; gl_FragColor = vec4(r > .36 ? vec3(1.) : vTint, 1.);
      #include <colorspace_fragment>
      }`,
  });
  // World grid on the ground plane, as in the lab: minor lines at 0.42 weight, every fifth line full, the X (red) and
  // Z (blue) axes through the origin, everything faded with distance from the subject (motion, robot and cameras).
  const gridMaterial = () => new T.ShaderMaterial({
    uniforms: {uS: {value: 1}, uR: {value: 7}, uC: {value: new T.Vector2()}, uH: {value: new T.Vector2(1, 1)}, uPx: {value: 1.2}, uOp: {value: .36},
      uGrid: {value: srgb('#919ca9')}, uX: {value: srgb('#cd7379')}, uZ: {value: srgb('#709bcc')}},
    transparent: true, depthWrite: false, side: T.DoubleSide,
    vertexShader: `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uS, uR, uPx, uOp; uniform vec2 uC, uH; uniform vec3 uGrid, uX, uZ; varying vec3 vW;
      float grid(vec2 c, float w) { vec2 f = fwidth(c), d = abs(fract(c - .5) - .5) / max(f, 1e-6); return 1. - clamp(min(d.x, d.y) - (w * .5 - .5), 0., 1.); }
      float axis(float c, float w) { return 1. - clamp(abs(c) / max(fwidth(c), 1e-6) - (w * .5 - .5), 0., 1.); }
      void main() {
        vec2 p = vW.xz, q = max(abs(p - uC) - uH, 0.); float fade = exp(-pow(length(q) / uR, 2.6));
        float g = max(grid(p / uS, uPx) * .38, grid(p / (5. * uS), uPx * 1.15)) * uOp;
        float ax = axis(p.y, uPx * 1.6) * .6, az = axis(p.x, uPx * 1.6) * .6;
        vec3 col = uGrid; float a = g;
        if (ax > a) { col = uX; a = ax; } if (az > a) { col = uZ; a = az; }
        a *= fade; if (a < .004) discard; gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
  });
  function badge(text, hex) {
    const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d');
    x.font = '600 40px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = hex; x.fillText(text, 48, 50);
    const map = new T.CanvasTexture(c); map.colorSpace = T.SRGBColorSpace;
    return new T.Sprite(new T.SpriteMaterial({map, transparent: true, depthWrite: false, depthTest: false}));
  }
  const nice = x => {const e = 10 ** Math.floor(Math.log10(x)), m = x / e; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;};

  // ---------------------------------------------------------------- materials (the lab's three mesh styles)
  function meshMaterial(part, style, actor) {
    const base = {side: T.DoubleSide, transparent: (part.opacity || 1) < 1, opacity: part.opacity || 1, depthWrite: (part.opacity || 1) >= 1};
    if (style === 'flat') return new T.MeshBasicMaterial({...base, color: 0xcccccc});
    if (style === 'clay' || actor) return new T.MeshStandardMaterial({...base, color: actor ? 0xbdbdbd : 0xbac1c9, roughness: actor ? .85 : .82, metalness: 0, envMapIntensity: actor ? 1 : .3});
    return new T.MeshStandardMaterial({...base, color: new T.Color().setRGB(...part.color), roughness: part.rough, metalness: part.metal});
  }

  // Per-case adjustments to the opening view: front = face a head-camera robot, yaw (rad, added), pitch (rad), zoom (x dist).
  const HOME = {
    'GenieSim3.0-0': {front: true}, 'GenieSim3.0-2': {front: true},
    'behavior-1k-2026-challenge-demos-2': {front: true}, 'behavior-1k-2026-challenge-demos-4': {front: true},
  };

  // ---------------------------------------------------------------- viewer
  class Viewer {
    constructor(el, opts = {}) {
      this.el = el; this.opts = Object.assign({background: '#FFFFFF', flowWidth: 4.2, dotSize: 9, cloudSize: 2.2, style: 'source', flowFade: [.26, 1], future: true, flowAhead: 20}, opts);
      this.renderer = new T.WebGLRenderer({antialias: true, preserveDrawingBuffer: false});
      this.renderer.setPixelRatio(Math.min(2, root.devicePixelRatio || 1));
      this.renderer.outputColorSpace = T.SRGBColorSpace; this.renderer.toneMappingExposure = 1.12;
      el.appendChild(this.renderer.domElement);
      this.scene = new T.Scene(); this.scene.background = new T.Color(this.opts.background);
      this.cam = new T.PerspectiveCamera(36, 1, 0.01, 2000);
      // The lab's studio: an environment of three light cards, a sky/ground fill and two keys.
      const studio = new T.Scene(); studio.background = new T.Color(.32, .35, .4);
      for (const [p, s, w] of [[[0, 5, 0], [8, .1, 8], 2], [[5, 2, -5], [.1, 5, 8], 4], [[-5, 1, 5], [.1, 4, 8], 2]]) {
        const card = new T.Mesh(new T.BoxGeometry(...s), new T.MeshBasicMaterial({color: new T.Color(w, w, w)})); card.position.set(...p); studio.add(card);
      }
      const pmrem = new T.PMREMGenerator(this.renderer); this.env = pmrem.fromScene(studio, .06).texture; pmrem.dispose();
      this.scene.add(new T.HemisphereLight(0xf5f3ff, 0x9aabc0, 2));
      for (const [p, i] of [[[4, 10, 6], 3], [[-5, 4, -3], 1]]) {const l = new T.DirectionalLight(0xffffff, i); l.position.set(...p); this.scene.add(l);}
      this.group = new T.Group(); this.scene.add(this.group);
      this.layers = {mesh: true, cloud: true, flow: true, cameras: true, grid: true}; this.style = this.opts.style;
      this.frame = 0; this.orbit = {yaw: 0, pitch: .3, dist: 5, target: new T.Vector3()};
      this._controls(); new ResizeObserver(() => this._resize()).observe(el); this._resize();
    }
    _resize() {
      const w = this.el.clientWidth, h = this.el.clientHeight; if (!w || !h) return;
      this.renderer.setSize(w, h, false); this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
      this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); this.render();
    }
    _clear() {
      this.group.traverse(o => {if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => {if (m.map) m.map.dispose(); m.dispose();});});
      this.group.clear(); this.meshes = []; this.cams = []; this.ribbonMats = [];
    }
    async show(id) {
      this.id = id; const pack = await root.ASTER_VIEWER.load(id); if (this.id !== id) return;
      const model = pack.robot ? await root.ASTER_VIEWER.loadModel(pack.robot.model) : null; if (this.id !== id) return;
      this._clear(); this.pack = pack; this.F = pack.frames;
      const tr = pack.tracks, N = tr.n, F = pack.frames, P = dequant(tr);  // N x F x 3
      const at = (n, f) => [P[(n * F + f) * 3], P[(n * F + f) * 3 + 1], P[(n * F + f) * 3 + 2]];
      const ok = p => Number.isFinite(p[0]);
      this._at = at; this._ok = ok; this._N = N;
      this.dot = this.opts.dotSize * Math.min(1, Math.max(.34, 1.25 - N / 250));   // dense flows get smaller heads, so the flow reads
      // Flow: Turbo colour by starting-height rank (top = blue, bottom = red), as in the film and the figures.
      const first = Array.from({length: N}, (_, n) => {for (let f = 0; f < F; f++) {const p = at(n, f); if (ok(p)) return p;} return [0, 0, 0];});
      const order = first.map((p, n) => [p[1], n]).sort((a, b) => b[0] - a[0]), colour = new Array(N);
      order.forEach(([, n], r) => {colour[n] = turbo(.08 + .86 * (N > 1 ? r / (N - 1) : .5));});
      const segs = [];
      for (let n = 0; n < N; n++) for (let f = 1; f < F; f++) {const a = at(n, f - 1), b = at(n, f); if (ok(a) && ok(b)) segs.push({a, b, c: colour[n], f: [(f - 1) / (F - 1), f / (F - 1)]});}
      this.flow = this._ribbon(segs, {width: this.opts.flowWidth, taper: 1, timed: true, future: this.opts.future, depth: true, fade: this.opts.flowFade}); this.flow.renderOrder = 10;
      // The future flow always shows the same stretch ahead, flowAhead frames, so it keeps a steady length as it plays.
      const trail = this.opts.future ? Math.min(1, this.opts.flowAhead / (F - 1)) : 0;
      this.flow.material.uniforms.uTrail.value = trail;
      const hg = new T.BufferGeometry(); hg.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(N * 3), 3));
      hg.setAttribute('tint', new T.Float32BufferAttribute(colour.flatMap(c => [c.r, c.g, c.b]), 3)); hg.setAttribute('on', new T.Float32BufferAttribute(new Float32Array(N), 1));
      this.heads = new T.Points(hg, dotMaterial()); this.heads.frustumCulled = false; this.heads.renderOrder = 11; this.group.add(this.heads);
      // Meshes: robot links from the shared model (one transform per visual per frame) or actor snapshots.
      if (model) model.visuals.forEach((v, i) => {
        const xf = pack.robot.xf[i]; if (!xf) return; const x = new Float32Array(bytes(xf));
        for (const part of v.parts) this._addMesh(part, x, false);
      });
      for (const part of pack.meshes || []) this._addMesh(part, part.xf ? new Float32Array(bytes(part.xf)) : null, true);
      // Point cloud (lifted cases).
      if (pack.cloud) {
        const pos = dequant(pack.cloud), rgb = new Uint8Array(bytes(pack.cloud.rgb)), col = new Float32Array(rgb.length), c = new T.Color();
        for (let i = 0; i < rgb.length; i += 3) {c.setRGB(rgb[i] / 255, rgb[i + 1] / 255, rgb[i + 2] / 255, T.SRGBColorSpace); col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b;}
        const cg = new T.BufferGeometry(); cg.setAttribute('position', new T.BufferAttribute(pos, 3)); cg.setAttribute('color', new T.BufferAttribute(col, 3));
        this.cloud = new T.Points(cg, new T.PointsMaterial({size: this.opts.cloudSize * this.renderer.getPixelRatio(), sizeAttenuation: false, vertexColors: true}));
        this.cloud.renderOrder = -1; this.group.add(this.cloud); this._cloudY = pos;
      } else {this.cloud = null; this._cloudY = null;}
      this._world(first);
      this._cameras();
      // sourceView keeps a point cloud at its source camera, the view that matches the observation.
      this.home = this.opts.sourceView && pack.kind === 'cloud' ? pack.view : this._fit(pack);
      this.resetView(); this.applyLayers(); this.setFrame(this.frame);
    }
    _ribbon(segs, opts) {const m = ribbons(segs, ribbonMaterial({...opts, transparent: !opts.timed})); this.group.add(m); this.ribbonMats.push(m.material); return m;}
    _addMesh(part, xf, actor) {
      const mesh = new T.Mesh(partGeometry(part), meshMaterial(part, this.style, actor)); mesh.matrixAutoUpdate = false;
      mesh.userData = {part, xf, actor}; if (part.opacity < 1) mesh.renderOrder = 1;
      // A part that genuinely deforms ships its keyframe geometries instead of a transform; blend between them.
      if (part.keys) {
        const lo = part.lo, sp = part.hi.map((h, k) => h - lo[k]);
        mesh.userData.keys = part.keys.map(k => {
          const q = new Uint16Array(bytes(k)), v = new Float32Array(q.length);
          for (let i = 0; i < q.length; i++) {const c = i % 3; v[i] = lo[c] + q[i] / 65535 * sp[c];}
          return v;
        });
        mesh.userData.keyFrames = part.keyFrames;
      }
      this.group.add(mesh); this.meshes.push(mesh); return mesh;
    }
    setStyle(style) {
      this.style = style;
      for (const m of this.meshes || []) {m.material.dispose(); m.material = meshMaterial(m.userData.part, style, m.userData.actor);}
      this.applyLayers();
    }
    // Subject box (motion, robot at its first frame, cameras) on the ground: it sets grid scale, focus and fade.
    _subject(first) {
      const box = new T.Box3(), v = new T.Vector3();
      for (let n = 0; n < this._N; n++) for (let f = 0; f < this.F; f += 4) {const p = this._at(n, f); if (this._ok(p)) box.expandByPoint(v.set(...p));}
      for (const m of this.meshes) {m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox.clone(); if (m.userData.xf) b.applyMatrix4(xfMatrix(m.userData.xf, 0)); box.union(b);}
      return box.isEmpty() ? new T.Box3(new T.Vector3(-1, -1, -1), new T.Vector3(1, 1, 1)) : box;
    }
    _world(first) {
      const box = this._subject(first); this.subject = box.clone();
      const size = box.getSize(new T.Vector3()), s = nice(Math.max(size.x, size.z, size.y * .6) / 6), c = box.getCenter(new T.Vector3());
      // Ground: the lab's y = 0, except for lifted clouds (camera frame), which sit on their lowest points.
      let y0 = 0;
      if (this._cloudY) {const ys = []; for (let i = 1; i < this._cloudY.length; i += 30) if (Number.isFinite(this._cloudY[i])) ys.push(this._cloudY[i]); ys.sort((a, b) => a - b); y0 = ys[Math.floor(ys.length * .03)] || 0;}
      this.scale = s; this.ground = y0;
      const half = new T.Vector2(size.x / 2, size.z / 2), R = Math.max(1.6 * s, .2 * Math.hypot(size.x, size.z)), ext = Math.hypot(half.x, half.y) + 3 * R;
      const g = new T.Mesh(new T.PlaneGeometry(2 * ext, 2 * ext).rotateX(-Math.PI / 2), gridMaterial());
      g.position.set(c.x, y0 - 1e-4 * s, c.z); g.renderOrder = -3; g.frustumCulled = false;
      const u = g.material.uniforms;
      u.uS.value = s; u.uR.value = R; u.uC.value.set(c.x, c.z); u.uH.value.copy(half);
      this.grid = new T.Group(); this.grid.add(g); this.gridPlane = g; this.group.add(this.grid);
      const fade = p => Math.exp(-((Math.hypot(Math.max(Math.abs(p.x - c.x) - half.x, 0), Math.max(Math.abs(p.z - c.z) - half.y, 0)) / R) ** 2.6));
      // Y axis (green) up from the origin, and the X / Y / Z labels at 2.3 grid units, faded like the grid.
      const o = new T.Vector3(0, y0, 0), k = fade(o) * .6, green = srgb('#65a58c');
      if (k > .02) {
        const yAxis = ribbons([{a: [0, y0, 0], b: [0, y0 + 2.6 * s, 0], c: green, al: [k, 0]}], ribbonMaterial({width: 2.2, depth: true, transparent: true}));
        yAxis.renderOrder = -2; this.grid.add(yAxis); this.ribbonMats.push(yAxis.material);
      }
      [['X', '#cd7379', [2.3 * s, y0 + .16 * s, 0]], ['Y', '#65a58c', [0, y0 + 2.75 * s, 0]], ['Z', '#709bcc', [0, y0 + .16 * s, 2.3 * s]]].forEach(([t, hex, p]) => {
        const l = badge(t, hex), a = .85 * fade(new T.Vector3(...p)); if (a < .03) return;
        l.material.opacity = a; l.position.set(...p); l.scale.setScalar(.42 * s); l.renderOrder = -1; this.grid.add(l);
      });
    }
    // Source cameras, lab style: blue pose glyph (frustum + up notch + faint fill) at the current frame, a sampled
    // trail of earlier poses and a gray path when the camera moves.
    _cameras() {
      const blue = srgb('#659ed0'), gray = srgb('#8b929e'), F = this.F, sub = this.subject.getSize(new T.Vector3()).length(), size0 = Math.min(.34 * this.scale, .09 * sub);
      // A camera that films the scene from a distance (captured video, a head camera) is drawn in proportion to that
      // distance, so it still reads once the view is pulled back to show it.
      const far = {cloud: .14, flow: .07, actor: .1}[this.pack.kind] || 0, sc = this.subject.getCenter(new T.Vector3());
      for (const cm of this.pack.cameras || []) {
        const poses = new Float32Array(bytes(cm.poses)), [fx, fy, cx, cy] = cm.K;
        const size = Math.max(size0, far * sc.distanceTo(new T.Vector3(poses[3], poses[7], poses[11])));
        const c = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => [(u - cx) / fx * size, -(v - cy) / fy * size, -size]);
        const top = c[0][1], notch = [[-.25 * size, top * 1.06, -size], [0, top * 1.06 + .3 * size, -size], [.25 * size, top * 1.06, -size]];
        const edges = []; for (let i = 0; i < 4; i++) edges.push([[0, 0, 0], c[i]], [c[i], c[(i + 1) % 4]]);
        edges.push([notch[0], notch[1]], [notch[1], notch[2]]);
        const glyph = (alpha, m) => edges.map(([a, b]) => ({a: m ? new T.Vector3(...a).applyMatrix4(m).toArray() : a, b: m ? new T.Vector3(...b).applyMatrix4(m).toArray() : b, c: blue, al: [alpha, alpha]}));
        const live = this._ribbon(glyph(.9), {width: 2.7}); live.matrixAutoUpdate = false; live.renderOrder = 12;
        const fill = new T.Mesh(new T.BufferGeometry().setFromPoints([0, 1, 2, 0, 2, 3].map(i => new T.Vector3(...c[i]))),
          new T.MeshBasicMaterial({color: blue, transparent: true, opacity: .08, side: T.DoubleSide, depthWrite: false, depthTest: false}));
        fill.matrixAutoUpdate = false; fill.renderOrder = 11; this.group.add(fill);
        for (const m of [live, fill]) {m.userData.poses = poses; m.userData.static = cm.static; this.cams.push(m);}
        if (!cm.static) {
          const trail = [], path = [];
          for (let f = 0; f < F; f += 12) trail.push(...glyph(.22, xfMatrix(poses, f * 12)));
          for (let f = 1; f < F; f++) path.push({a: [poses[(f - 1) * 12 + 3], poses[(f - 1) * 12 + 7], poses[(f - 1) * 12 + 11]], b: [poses[f * 12 + 3], poses[f * 12 + 7], poses[f * 12 + 11]], c: gray, al: [.75, .75]});
          const t = this._ribbon(trail, {width: 1.6}), p = this._ribbon(path, {width: 2.2}); t.renderOrder = p.renderOrder = 9; this.cams.push(t, p);
        }
      }
    }
    // Opening view. Captured video looks over the source camera's shoulder from the side, far enough out to show the
    // camera, its path and the scene together. Head-camera robots and hands are seen from the front, so the body does not
    // hide the hands and the camera stays behind them. Objects are framed on the motion and include the camera only when
    // it is close by.
    _fit(pack) {
      const v = pack.view, F = this.F, vec = new T.Vector3(), core = new T.Box3(), pts = [];
      const corners = b => [0, 1, 2, 3, 4, 5, 6, 7].map(k => new T.Vector3(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z));
      for (let n = 0; n < this._N; n++) for (let f = 0; f < F; f += 3) {const p = this._at(n, f); if (this._ok(p)) {pts.push(new T.Vector3(...p)); core.expandByPoint(vec.set(...p));}}
      const cs = core.getBoundingSphere(new T.Sphere()), reach = Math.max(cs.radius * 3, 1e-3);
      // Mesh parts near the motion: a far-off base link should not shrink the interaction to a dot.
      for (const m of this.meshes) {
        m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox.clone(); if (m.userData.xf) b.applyMatrix4(xfMatrix(m.userData.xf, 0));
        if (b.getCenter(vec).distanceTo(cs.center) < reach) pts.push(...corners(b));
      }
      const cams = (pack.cameras || []).map(cm => new Float32Array(bytes(cm.poses)));
      const path = cams.flatMap(q => Array.from({length: q.length / 12}, (_, f) => new T.Vector3(q[f * 12 + 3], q[f * 12 + 7], q[f * 12 + 11])));
      if (pack.kind !== 'actor' || path.every(p => p.distanceTo(cs.center) < reach)) pts.push(...path);
      // A lifted cloud adds its dense core (4th-96th percentile per axis), so stray far points do not set the view.
      if (this._cloudY) {
        const c = this._cloudY, ax = [[], [], []];
        for (let i = 0; i + 2 < c.length; i += 3 * 37) if (Number.isFinite(c[i])) for (let k = 0; k < 3; k++) ax[k].push(c[i + k]);
        if (ax[0].length > 20) {
          ax.forEach(a => a.sort((x, y) => x - y)); const pc = (a, u) => a[Math.floor(u * (a.length - 1))];
          pts.push(...corners(new T.Box3(new T.Vector3(...ax.map(a => pc(a, .04))), new T.Vector3(...ax.map(a => pc(a, .96))))));
        }
      }
      const t = HOME[this.id] || {}, q = cams[0], fwd = q ? new T.Vector3(-q[2], -q[6], -q[10]) : null;
      let yaw = v.yaw, pitch = Math.max(.32, Math.min(.9, v.pitch));
      if (fwd && Math.hypot(fwd.x, fwd.z) > .2) {
        if (pack.kind === 'cloud') {yaw = Math.atan2(-fwd.x, -fwd.z) + .55; pitch = .4;}
        else if (pack.kind === 'flow' || (pack.kind === 'urdf' && t.front)) {yaw = Math.atan2(fwd.x, fwd.z) + .6; pitch = .38;}
      }
      yaw += t.yaw || 0; if (t.pitch != null) pitch = t.pitch;
      if (!pts.length) pts.push(new T.Vector3());
      // Fit what the view actually sees: project onto the view axes and size the frame to the extent on screen.
      const d = new T.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      const right = new T.Vector3(0, 1, 0).cross(d).normalize(), up = d.clone().cross(right);
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const p of pts) [p.dot(right), p.dot(up), p.dot(d)].forEach((x, k) => {lo[k] = Math.min(lo[k], x); hi[k] = Math.max(hi[k], x);});
      const c = lo.map((x, k) => (x + hi[k]) / 2), tv = Math.tan(this.cam.fov * Math.PI / 360), th = tv * (this.cam.aspect || 1.4);
      const dist = Math.max((hi[1] - lo[1]) / 2 / tv, (hi[0] - lo[0]) / 2 / th) / .86 + (hi[2] - c[2]);
      const target = right.multiplyScalar(c[0]).add(up.multiplyScalar(c[1])).add(d.clone().multiplyScalar(c[2]));
      return {target: target.toArray(), yaw, pitch, dist: dist * (t.zoom || 1)};
    }
    setTime(t) {this.setFrame(t * (this.F - 1));}
    setFrame(f) {
      if (!this.pack) return;
      const F = this.F; f = Math.max(0, Math.min(F - 1, f)); this.frame = f;
      const i = Math.floor(f), j = Math.min(F - 1, i + 1), s = f - i;
      this.flow.material.uniforms.uFrame.value = f / (F - 1);
      const hp = this.heads.geometry.attributes.position, on = this.heads.geometry.attributes.on;
      for (let n = 0; n < this._N; n++) {
        const a = this._at(n, i), b = this._at(n, j), good = this._ok(a) && this._ok(b);
        if (good) hp.setXYZ(n, a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s);
        on.setX(n, good ? 1 : 0);
      }
      hp.needsUpdate = true; on.needsUpdate = true;
      const k = Math.round(f);
      for (const m of this.meshes) {
        if (m.userData.xf) xfMatrix(m.userData.xf, k * 12, m.matrix);
        if (m.userData.keys) this._morph(m, f);
      }
      for (const c of this.cams) if (c.userData.poses) xfMatrix(c.userData.poses, (c.userData.static ? 0 : k) * 12, c.matrix);
      this.render();
    }
    _morph(mesh, f) {
      const ks = mesh.userData.keys, fr = mesh.userData.keyFrames;
      let i = 0; while (i < fr.length - 2 && f >= fr[i + 1]) i++;
      const span = Math.max(1e-6, fr[i + 1] - fr[i]), t = Math.max(0, Math.min(1, (f - fr[i]) / span));
      const a = ks[i], b = ks[i + 1], attr = mesh.geometry.attributes.position, out = attr.array;
      for (let n = 0; n < out.length; n++) out[n] = a[n] + (b[n] - a[n]) * t;
      attr.needsUpdate = true; mesh.geometry.computeVertexNormals();
    }
    applyLayers(l) {
      Object.assign(this.layers, l || {});
      for (const m of this.meshes || []) m.visible = this.layers.mesh;
      if (this.cloud) this.cloud.visible = this.layers.cloud;
      if (this.flow) {this.flow.visible = this.layers.flow; this.heads.visible = this.layers.flow;}
      for (const c of this.cams || []) c.visible = this.layers.cameras;
      if (this.grid) this.grid.visible = this.layers.grid;
      // The lab lights meshes with the studio environment and ACES; clouds and flat gray stay untouched.
      const lit = this.layers.mesh && (this.meshes || []).length && this.style !== 'flat';
      this.renderer.toneMapping = lit ? T.ACESFilmicToneMapping : T.NoToneMapping; this.scene.environment = lit ? this.env : null;
      this.render();
    }
    has() {const p = this.pack || {}; return {mesh: !!(this.meshes && this.meshes.length), cloud: !!p.cloud, flow: true, cameras: !!(p.cameras && p.cameras.length), grid: true};}
    resetView() {const h = this.home; if (!h) return; Object.assign(this.orbit, {yaw: h.yaw, pitch: h.pitch, dist: h.dist}); this.orbit.target.set(...h.target); this.render();}
    render() {
      if (!this.renderer) return;
      const o = this.orbit, c = Math.cos(o.pitch);
      this.cam.position.set(o.target.x + o.dist * Math.sin(o.yaw) * c, o.target.y + o.dist * Math.sin(o.pitch), o.target.z + o.dist * Math.cos(o.yaw) * c);
      this.cam.near = o.dist / 200; this.cam.far = o.dist * 60; this.cam.updateProjectionMatrix(); this.cam.lookAt(o.target);
      const size = this.renderer.getDrawingBufferSize(new T.Vector2()), pr = this.renderer.getPixelRatio();
      for (const m of this.ribbonMats || []) {m.uniforms.uRes.value.copy(size); m.uniforms.uWidth.value = m.uniforms.uBase.value * pr;}
      if (this.heads) this.heads.material.uniforms.uSize.value = this.dot * pr;
      if (this.gridPlane) this.gridPlane.material.uniforms.uPx.value = 1.2 * pr;
      this.renderer.render(this.scene, this.cam);
    }
    _controls() {
      const el = this.renderer.domElement; el.style.touchAction = 'none'; el.style.cursor = 'grab';
      let drag = null, pinch = null; const pts = new Map();
      const pan = (dx, dy) => {
        const o = this.orbit, k = o.dist * 2 * Math.tan(this.cam.fov * Math.PI / 360) / this.el.clientHeight;
        const right = new T.Vector3().setFromMatrixColumn(this.cam.matrixWorld, 0), up = new T.Vector3().setFromMatrixColumn(this.cam.matrixWorld, 1);
        o.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      };
      el.addEventListener('pointerdown', e => {
        el.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); this.active = true; this.el.classList.add('active');
        if (pts.size === 2) {const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); drag = null;}
        else drag = {x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey}; el.style.cursor = 'grabbing';
      });
      el.addEventListener('pointermove', e => {
        if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pinch && pts.size === 2) {const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); this.orbit.dist *= pinch / d; pinch = d; this.render(); return;}
        if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
        if (drag.pan) pan(dx, dy); else {this.orbit.yaw -= dx * .0065; this.orbit.pitch = Math.max(-1.45, Math.min(1.45, this.orbit.pitch + dy * .0065));}
        this.render();
      });
      const up = e => {pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) {drag = null; el.style.cursor = 'grab';}};
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      el.addEventListener('contextmenu', e => e.preventDefault());
      el.addEventListener('dblclick', () => this.resetView());
      // Scroll zooms only after the viewer has been clicked, so the page still scrolls past it.
      el.addEventListener('wheel', e => {if (!this.active) return; e.preventDefault(); this.orbit.dist *= Math.exp(e.deltaY * .0012); this.render();}, {passive: false});
      this.el.addEventListener('pointerleave', () => {this.active = false; this.el.classList.remove('active');});
    }
  }
  Viewer.HOME = HOME; root.AsterViewer = Viewer;
})(window);
