/* Pre-training data: the thirteen sources stream through one action (3D point motion + camera) into one mixture.
   Each source is a swarm of moving points, sized by its sampling weight; points are squares before the action gate and
   round after it, then orbit one globe. The animation plays once when the section scrolls into view and pauses off
   screen. Hovering a source or lane, in the list or on the canvas, highlights it and shows example frames. */
(function () {
  'use strict';
  const D = window.SITE && window.SITE.data, root = document.getElementById('data-viz');
  if (!D || !root) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lanes = D.lanes, sources = D.sources;
  const laneOf = id => lanes.findIndex(l => l.id === id);
  const h = (tag, cls, html) => {const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n;};

  /* ---------------------------------------------------------------- DOM */
  const stage = h('div', 'dv-stage'), cv = h('canvas'), replay = h('button', 'dv-replay', 'Replay');
  replay.type = 'button'; cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', 'Thirteen data sources stream through one action into one pre-training mixture');
  stage.append(cv, replay);
  const panel = h('div', 'dv-panel');
  panel.appendChild(h('div', 'dv-head', '<b>One pre-training mixture</b><span>13 sources &middot; about 80K hours of video</span>'));
  const preview = h('div', 'dv-preview'), thumbs = h('div', 'dv-thumbs'), cap = h('div', 'dv-cap');
  preview.append(thumbs, cap); panel.appendChild(preview);
  const rowOf = {}, laneHead = [];
  lanes.forEach((l, li) => {
    const box = h('div', 'dv-lane'), head = h('div', 'dv-lane-h', `<b>${l.name}</b><span>${l.weight.toFixed(1)}%</span>`);
    head.tabIndex = 0; laneHead[li] = head; box.appendChild(head);
    head.addEventListener('mouseenter', () => setHi({lane: li}, false));
    head.addEventListener('focus', () => setHi({lane: li}, false));
    head.addEventListener('click', () => setHi({lane: li}, true));
    sources.forEach((s, si) => {
      if (s.lane !== l.id) return;
      const r = h('button', 'dv-src', `<i style="background:${s.color}"></i><span class="n">${s.name}${s.hours ? `<small>${s.hours}</small>` : ''}</span>` +
        `<span class="t">${s.origin === 'real' ? 'real' : 'sim'}</span><span class="w">${s.weight.toFixed(1)}%</span>`);
      r.type = 'button'; rowOf[si] = r; box.appendChild(r);
      r.addEventListener('mouseenter', () => setHi({src: si}, false));
      r.addEventListener('focus', () => setHi({src: si}, false));
      r.addEventListener('click', () => setHi({src: si}, true));
    });
    panel.appendChild(box);
  });
  panel.appendChild(h('div', 'dv-foot', 'Sampling weights; hours where the source reports them. Real 64.8% &middot; simulated 35.2%.'));
  panel.addEventListener('mouseleave', () => {if (!sticky) setHi(null, false);});
  root.append(stage, panel);

  /* ---------------------------------------------------------------- highlight */
  let hi = null, sticky = false;
  const on = p => !hi || hi.src === p.s || hi.lane === p.lane;
  function setHi(next, stick) {
    if (stick && hi && next && hi.src === next.src && hi.lane === next.lane) {next = null; stick = false;}
    hi = next; sticky = !!stick && !!next;
    root.classList.toggle('dim', !!hi);
    Object.entries(rowOf).forEach(([si, r]) => r.classList.toggle('on', !!hi && (hi.src === +si || hi.lane === laneOf(sources[si].lane))));
    laneHead.forEach((e, li) => e.classList.toggle('on', !!hi && hi.lane === li));
    showPreview(); if (!running) draw();
  }
  // Preview frames follow the lane (robot, human, object & scene), not the individual source; the block keeps a fixed
  // height so hovering never moves the list under the cursor.
  let shown = '';
  function showPreview() {
    const li = hi ? (hi.lane != null ? hi.lane : laneOf(sources[hi.src].lane)) : -1;
    const key = String(li);
    if (key === shown) return;
    shown = key;
    const list = li >= 0 ? lanes[li].examples : D.preview;
    thumbs.innerHTML = ''; thumbs.style.gridTemplateColumns = `repeat(${list.length}, 1fr)`;
    list.forEach(e => {const i = h('img'); i.src = e.src; i.alt = ''; i.decoding = 'async'; thumbs.appendChild(i);});
    cap.textContent = li >= 0 ? `${lanes[li].name} · ${lanes[li].blurb}` : 'Example frames from the pre-training sources';
  }

  /* ---------------------------------------------------------------- layout and particles */
  const ctx = cv.getContext('2d'), K = 7;
  let W = 0, H = 0, dpr = 1, L = null, P = [];
  const font = getComputedStyle(root).fontFamily;
  function rnd(seed) {let x = seed >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);}
  function layout() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = stage.clientWidth;
    const wide = root.clientWidth >= 760;
    H = wide ? Math.max(380, Math.min(560, panel.offsetHeight)) : Math.round(Math.max(300, W * 0.82));
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px';
    const R = Math.min(0.24 * W, 0.36 * H);
    L = {laneX: 0.13 * W, laneY: [0.24, 0.52, 0.80].map(f => f * H), spread: Math.min(W, H) * 0.06, gateX: 0.40 * W,
         cx: 0.73 * W, cy: 0.52 * H, R, tilt: 0.38};
    const N = W < 520 ? 320 : 560, r = rnd(7);
    P = [];
    sources.forEach((s, si) => {
      const n = Math.max(10, Math.round(s.weight / 100 * N)), lane = laneOf(s.lane);
      for (let k = 0; k < n; k++) {
        const a = r() * 6.283, d = Math.sqrt(r()) * L.spread * 1.15;
        P.push({s: si, lane, color: s.color, ox: Math.cos(a) * d * 1.5, oy: Math.sin(a) * d,
                lr: 3 + r() * 6, lw: 0.6 + r() * 1.4, lp: r() * 6.283,
                lat: (r() * 2 - 1) * 1.15, lon: r() * 6.283, w: 0.18 + r() * 0.22, rr: 1.0 + r() * 0.06,
                delay: r() * 1.1, hist: new Float32Array(2 * K), hn: 0, x: 0, y: 0, z: 1, a: 0, round: false});
      }
    });
  }
  const ease = u => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  function globe(p, t) {
    const lon = p.lon + p.w * t, r = L.R * p.rr, ct = Math.cos(L.tilt), st = Math.sin(L.tilt);
    const x = r * Math.cos(p.lat) * Math.sin(lon), y = r * Math.sin(p.lat), z = r * Math.cos(p.lat) * Math.cos(lon);
    return [L.cx + x, L.cy - (y * ct - z * st), y * st + z * ct];
  }
  const T0 = 1.2, TRAVEL = 2.2;
  function place(p, t) {
    const lx = L.laneX + p.ox + p.lr * Math.cos(p.lw * t + p.lp), ly = L.laneY[p.lane] + p.oy + p.lr * Math.sin(p.lw * t + p.lp);
    const g = globe(p, t), tb = T0 + p.delay;
    if (t <= tb) {p.x = lx; p.y = ly; p.z = 1; p.a = Math.min(1, t / T0); p.round = false; return;}
    const u = Math.min(1, (t - tb) / TRAVEL), e = ease(u);
    if (u >= 1) {p.x = g[0]; p.y = g[1]; p.z = g[2]; p.a = 1; p.round = true; return;}
    const x1 = L.gateX, y1 = L.laneY[p.lane], x2 = L.gateX + 0.1 * W, y2 = g[1], m = 1 - e;
    p.x = m * m * m * lx + 3 * m * m * e * x1 + 3 * m * e * e * x2 + e * e * e * g[0];
    p.y = m * m * m * ly + 3 * m * m * e * y1 + 3 * m * e * e * y2 + e * e * e * g[1];
    p.z = 1; p.a = 1; p.round = p.x > L.gateX;
  }

  /* ---------------------------------------------------------------- guide paths and tracers (after the merge) */
  const DONE = T0 + 1.1 + TRAVEL;
  function guide(li, u) {  // lane cluster -> gate -> left rim of the globe
    const x0 = L.laneX + L.spread * 1.6, y0 = L.laneY[li], x3 = L.cx - L.R * 0.92, y3 = L.cy + (li - 1) * L.R * 0.35;
    const x1 = L.gateX, y1 = y0, x2 = L.gateX + 0.08 * W, y2 = y3, m = 1 - u;
    return [m * m * m * x0 + 3 * m * m * u * x1 + 3 * m * u * u * x2 + u * u * u * x3, m * m * m * y0 + 3 * m * m * u * y1 + 3 * m * u * u * y2 + u * u * u * y3];
  }
  const laneColor = li => sources.filter(s => laneOf(s.lane) === li).sort((a, b) => b.weight - a.weight)[0].color;
  function drawGuides(alpha) {
    if (alpha <= 0) return;
    lanes.forEach((l, li) => {
      const dim = hi && hi.lane !== li && !(hi.src != null && laneOf(sources[hi.src].lane) === li);
      ctx.globalAlpha = alpha * (dim ? 0.12 : 0.45); ctx.strokeStyle = '#c9ced5'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      ctx.beginPath(); for (let k = 0; k <= 40; k++) {const q = guide(li, k / 40); k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]);} ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = laneColor(li);
      for (let k = 0; k < 5; k++) {
        const u = ((t - DONE) / 3.2 + k / 5) % 1, q = guide(li, u), r = 2.1;
        ctx.globalAlpha = alpha * (dim ? 0.12 : 0.9) * Math.min(1, u * 8, (1 - u) * 8);
        if (q[0] > L.gateX) {ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, 6.283); ctx.fill();} else ctx.fillRect(q[0] - r, q[1] - r, 2 * r, 2 * r);
      }
    });
    ctx.globalAlpha = 1;
  }

  /* ---------------------------------------------------------------- draw */
  let t = 0;
  function draw() {
    if (!L) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const gIn = Math.min(1, Math.max(0, (t - T0 * 0.6) / 1.2));
    // lane labels
    ctx.textBaseline = 'alphabetic';
    lanes.forEach((l, li) => {
      const dim = hi && hi.lane !== li && !(hi.src != null && laneOf(sources[hi.src].lane) === li);
      ctx.globalAlpha = dim ? 0.35 : 1;
      ctx.fillStyle = '#1a1a1a'; ctx.font = `600 ${W < 520 ? 11 : 12.5}px ${font}`; ctx.textAlign = 'center';
      ctx.fillText(l.name, L.laneX, L.laneY[li] - L.spread * 1.35);
      ctx.fillStyle = '#777'; ctx.font = `400 ${W < 520 ? 10 : 11}px ${font}`;
      ctx.fillText(`${l.weight.toFixed(1)}%`, L.laneX, L.laneY[li] + L.spread * 1.35 + 10);
    });
    ctx.globalAlpha = 1;
    // the action gate
    ctx.strokeStyle = 'rgba(118,185,0,0.55)'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(L.gateX, 0.14 * H); ctx.lineTo(L.gateX, 0.92 * H); ctx.stroke(); ctx.setLineDash([]);
    ctx.textAlign = 'center'; ctx.fillStyle = '#4e7c00'; ctx.font = `600 ${W < 520 ? 10.5 : 12}px ${font}`;
    ctx.fillText('one action', L.gateX, 0.08 * H);
    ctx.fillStyle = '#777'; ctx.font = `400 ${W < 520 ? 9.5 : 10.5}px ${font}`;
    ctx.fillText('3D point motion + camera', L.gateX, 0.08 * H + 14);
    // globe: graticule (front half) and outline
    ctx.globalAlpha = gIn;
    const ct = Math.cos(L.tilt), st = Math.sin(L.tilt);
    const proj = (lat, lon) => {const x = L.R * Math.cos(lat) * Math.sin(lon), y = L.R * Math.sin(lat), z = L.R * Math.cos(lat) * Math.cos(lon);
      return [L.cx + x, L.cy - (y * ct - z * st), y * st + z * ct];};
    ctx.strokeStyle = 'rgba(26,26,26,0.08)'; ctx.lineWidth = 1;
    const arc = pts => {ctx.beginPath(); let pen = false; for (const q of pts) {if (q[2] < 0) {pen = false; continue;} pen ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); pen = true;} ctx.stroke();};
    for (let la = -60; la <= 60; la += 30) {const pts = []; for (let k = 0; k <= 96; k++) pts.push(proj(la * Math.PI / 180, k / 96 * 6.283)); arc(pts);}
    for (let lo = 0; lo < 180; lo += 30) {const pts = []; for (let k = 0; k <= 96; k++) pts.push(proj(-Math.PI / 2 + k / 96 * Math.PI, lo * Math.PI / 180 + 0.3)); arc(pts);}
    drawGuides(Math.min(1, Math.max(0, (t - DONE) / 1.0)));
    // particles: back of the globe first, then outline, then front
    const layer = front => {
      for (const p of P) {
        if ((p.z >= 0) !== front) continue;
        const lit = on(p), a = p.a * (lit ? 1 : 0.1) * (p.z < 0 ? 0.3 : 1);
        if (a <= 0.01) continue;
        if (p.hn > 1) {
          ctx.globalAlpha = a * 0.35; ctx.strokeStyle = p.color; ctx.lineWidth = 1;
          ctx.beginPath(); const n = Math.min(p.hn, K);
          for (let k = 0; k < n; k++) {const j = (p.hn - 1 - k) % K; const x = p.hist[2 * j], y = p.hist[2 * j + 1]; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);}
          ctx.stroke();
        }
        ctx.globalAlpha = a; ctx.fillStyle = p.color;
        const r = (lit && hi ? 2.6 : 2.1) * (W < 520 ? 0.85 : 1);
        if (p.round) {ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.283); ctx.fill();}
        else ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r);
      }
    };
    layer(false);
    ctx.globalAlpha = gIn; ctx.strokeStyle = '#c9ced5'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(L.cx, L.cy, L.R, 0, 6.283); ctx.stroke();
    layer(true);
    ctx.globalAlpha = gIn; ctx.textAlign = 'center';
    ctx.fillStyle = '#1a1a1a'; ctx.font = `600 ${W < 520 ? 11 : 12.5}px ${font}`;
    ctx.fillText('one pre-training mixture', L.cx, Math.min(H - 22, L.cy + L.R + 26));
    ctx.fillStyle = '#777'; ctx.font = `400 ${W < 520 ? 10 : 11}px ${font}`;
    ctx.fillText('about 80K hours of video', L.cx, Math.min(H - 8, L.cy + L.R + 41));
    ctx.globalAlpha = 1;
  }
  function step(dt) {
    t += dt;
    for (const p of P) {place(p, t); const j = p.hn % K; p.hist[2 * j] = p.x; p.hist[2 * j + 1] = p.y; p.hn++;}
  }

  /* ---------------------------------------------------------------- run loop, visibility, input */
  let running = false, visible = false, last = 0, raf = 0;
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    step(dt); draw();
    if (visible && !reduce) raf = requestAnimationFrame(loop); else running = false;
  }
  function start() {if (running || reduce) return; running = true; last = performance.now(); raf = requestAnimationFrame(loop);}
  function settle() {t = DONE + 1.6; for (let k = 0; k < K; k++) step(0); draw();}
  new IntersectionObserver(es => {for (const e of es) {visible = e.isIntersecting; if (visible) start();}}, {threshold: 0.3}).observe(stage);
  replay.addEventListener('click', () => {if (reduce) return; t = 0; for (const p of P) p.hn = 0; start();});
  cv.addEventListener('pointermove', e => {
    if (sticky) return;
    const b = cv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    let best = null, bd = 196;
    for (const p of P) {if (p.a < 0.5) continue; const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) {bd = d; best = p;}}
    const next = best ? {src: best.s} : null;
    if ((next && next.src) !== (hi && hi.src) || (!next && hi)) setHi(next, false);
  });
  cv.addEventListener('pointerleave', () => {if (!sticky) setHi(null, false);});
  let rt = 0;
  let lastW = 0;  // re-layout on width changes only; height changes inside the panel never rebuild the canvas
  new ResizeObserver(() => {const w = root.clientWidth; if (w === lastW) return; lastW = w; clearTimeout(rt); rt = setTimeout(() => {const keep = t; layout(); t = 0; step(0); t = keep; for (let k = 0; k < K; k++) step(0); draw();}, 60);}).observe(root);
  layout(); showPreview();
  if (reduce) settle(); else {step(0); draw();}
})();
