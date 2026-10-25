/* ASTER project page, Cosmos Lab template edition. Everything is rendered from window.SITE (assets/data.js) into the
   template's sections; ../js/project.js adds the shared header, footer and hero metadata. Clips only load and play while
   on screen; tab panels exist only while selected; the 3D viewer is one instance that loads each case on demand. */
'use strict';
const S = window.SITE;
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => {const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n;};

/* ---------------------------------------------------------------- media */
const onScreen = new IntersectionObserver(es => {
  for (const e of es) {
    const v = e.target;
    if (e.isIntersecting) {if (!v.src) v.src = v.dataset.src; v.play().catch(() => {});} else v.pause();
  }
}, {rootMargin: '200px 0px'});
function vid(rec, {lazy = true} = {}) {
  const v = el('video'); v.muted = true; v.loop = true; v.playsInline = true; v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
  v.preload = 'none'; if (rec.poster) v.poster = rec.poster; v.width = rec.w; v.height = rec.h;
  if (lazy) {v.dataset.src = rec.src; onScreen.observe(v);} else {v.src = rec.src; v.autoplay = true;}
  return v;
}
function img(rec) {const i = el('img'); i.src = rec.src; i.loading = 'lazy'; i.alt = ''; if (rec.w) {i.width = rec.w; i.height = rec.h;} return i;}
const media = rec => rec.src.endsWith('.mp4') ? vid(rec) : img(rec);
function clip(rec, label, {note, accent} = {}) {
  const c = el('div', 'ax-clip'), f = el('div', 'f' + (accent ? ' accent' : ''));
  f.appendChild(media(rec)); f.addEventListener('click', () => lightbox(rec)); c.appendChild(f);
  if (label) c.appendChild(el('div', 'cap' + (accent ? ' accent' : ''), label + (note ? `<i>${note}</i>` : '')));
  return c;
}
function lightbox(rec) {
  const b = $('#lb-body'); b.innerHTML = '';
  if (rec.src.endsWith('.mp4')) {const v = el('video'); Object.assign(v, {src: rec.src, muted: true, loop: true, autoplay: true, controls: true, playsInline: true}); b.appendChild(v);}
  else b.appendChild(img(rec));
  $('#lightbox').hidden = false;
}
$('#lb-close').onclick = () => {$('#lightbox').hidden = true; $('#lb-body').innerHTML = '';};
$('#lightbox').onclick = e => {if (e.target.id === 'lightbox') $('#lb-close').onclick();};
document.addEventListener('keydown', e => {if (e.key === 'Escape') $('#lb-close').onclick();});

/* ---------------------------------------------------------------- tabs */
function tabs(bar, panel, items, render, start = 0) {
  bar.innerHTML = ''; let cur = -1;
  const show = i => {
    if (i === cur) return; cur = i;
    [...bar.children].forEach((b, k) => b.classList.toggle('active', k === i));
    if (panel) {panel.querySelectorAll('video').forEach(v => onScreen.unobserve(v)); panel.innerHTML = '';}
    const node = render(items[i], i); if (panel && node) panel.appendChild(node);
  };
  items.forEach((it, i) => {const b = el('button', 'nav-link', it.label + (it.n ? `<span class="n">${it.n}</span>` : '')); b.onclick = () => show(i); bar.appendChild(b);});
  if (start >= 0) show(start); return show;
}
const figure = (box, rec) => {const i = img(rec); i.onclick = () => lightbox(rec); box.appendChild(i);};

/* ---------------------------------------------------------------- hero + method */
for (const r of S.hero) $('#hero-grid').appendChild(vid(r));
figure($('#fig-pipeline'), S.figures.pipeline);
figure($('#fig-injection'), S.figures.injection);
figure($('#fig-routes'), S.figures.routesRow);
tabs($('#route-tabs'), $('#route-panel'), S.figures.routes.map(r => ({label: `${r.n} · ${r.name}`, r})), ({r}) => {
  const f = el('div', 'figure-block ax-wide'); figure(f, r.image); return f;
}, -1);   // closed until a route is chosen

/* ---------------------------------------------------------------- explorer: one viewer, one clock */
const ex = {viewer: new AsterViewer($('#viewer')), video: $('#ex-video'), playing: true, case: null};
const LAYER_NAMES = {mesh: 'Mesh', cloud: 'Point cloud', flow: 'Point flow', cameras: 'Cameras', grid: 'World grid'};
const STYLES = [['source', 'Original'], ['clay', 'Soft gray'], ['flat', 'Flat gray']];   // the Motion Lab mesh styles
const KIND = {urdf: 'URDF + point flow + cameras', cloud: 'Point cloud + point flow + camera', actor: 'Object snapshots + point flow + camera', flow: 'Point flow + cameras'};
function drawLayers() {
  const box = $('#layers'); box.innerHTML = ''; const has = ex.viewer.has();
  for (const k of Object.keys(LAYER_NAMES)) {
    if (!has[k]) continue;
    const b = el('button', ex.viewer.layers[k] ? 'on' : '', LAYER_NAMES[k]);
    b.onclick = () => {ex.viewer.applyLayers({[k]: !ex.viewer.layers[k]}); drawLayers();}; box.appendChild(b);
  }
  if (!has.mesh || ex.viewer.pack.kind !== 'urdf') return;
  const seg = el('span', 'seg');
  for (const [k, name] of STYLES) {const b = el('button', ex.viewer.style === k ? 'on' : '', name); b.onclick = () => {ex.viewer.setStyle(k); drawLayers();}; seg.appendChild(b);}
  box.appendChild(seg);
}
async function openCase(c) {
  ex.case = c; $('#loading').hidden = false;
  document.querySelectorAll('#case-chips .ax-chip').forEach(ch => ch.classList.toggle('on', ch.dataset.id === c.id));
  ex.video.src = c.output.src; ex.video.poster = c.output.poster || '';
  $('#ex-obs').src = c.observation.src; $('#ex-title').textContent = c.title;
  await ex.viewer.show(c.pack); if (ex.case !== c) return;
  $('#ex-sub').textContent = (c.dataset ? c.dataset + ' · ' : '') + KIND[ex.viewer.pack.kind] + ' · left image: the first frame ASTER sees';
  $('#loading').hidden = true; drawLayers(); ex.video.currentTime = 0; if (ex.playing) ex.video.play().catch(() => {});
}
function groupChips(g) {
  const box = $('#case-chips'); box.innerHTML = '';
  for (const c of S.explorer.cases.filter(c => c.group === g)) {
    const b = el('button', 'ax-chip', c.title); b.dataset.id = c.id; b.onclick = () => openCase(c); box.appendChild(b);
  }
}
const groupShow = tabs($('#group-tabs'), null, S.explorer.groups.map(g => ({label: g, n: S.explorer.cases.filter(c => c.group === g).length, g})), ({g}) => {
  groupChips(g); openCase(S.explorer.cases.find(c => c.group === g));
});
function tick() {
  const v = ex.video;
  if (v.duration) {const t = v.currentTime / v.duration; ex.viewer.setTime(t); $('#ex-scrub').value = Math.round(t * 1000); $('#ex-time').textContent = v.currentTime.toFixed(1) + ' s';}
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
$('#ex-play').onclick = () => {ex.playing = !ex.playing; $('#ex-play').textContent = ex.playing ? '❚❚' : '▶'; ex.playing ? ex.video.play() : ex.video.pause();};
$('#ex-scrub').oninput = e => {ex.playing = false; $('#ex-play').textContent = '▶'; ex.video.pause(); if (ex.video.duration) ex.video.currentTime = e.target.value / 1000 * ex.video.duration;};
$('#reset').onclick = () => ex.viewer.resetView();
// Pause the explorer when it is off screen.
new IntersectionObserver(([e]) => {if (!e.isIntersecting) ex.video.pause(); else if (ex.playing) ex.video.play().catch(() => {});}).observe($('#viewer'));
function goTo3D(id) {
  const c = S.explorer.cases.find(x => x.id === id); if (!c) return;
  groupShow(S.explorer.groups.indexOf(c.group)); openCase(c); $('#explore').scrollIntoView({behavior: 'smooth'});
}

/* ---------------------------------------------------------------- justified rows */
// One height per row, chosen so the clips exactly fill the width; every clip keeps its own aspect ratio.
function justify(row, recs, maxH, gap = 8) {
  const fit = () => {
    if (innerWidth < 900) {row.style.removeProperty('--h'); return;}
    const W = row.clientWidth - recs.length * 2 - gap * (recs.length - 1); if (W <= 0) return;
    const h = Math.min(maxH, W / recs.reduce((a, r) => a + r.w / r.h, 0));
    row.style.setProperty('--h', Math.floor(h) + 'px');
  };
  new ResizeObserver(fit).observe(row); requestAnimationFrame(fit);
}

/* ---------------------------------------------------------------- comparison rows */
function rowPanel(c, items, height) {
  const box = el('div'), head = el('div', 'ax-panel-head');
  head.appendChild(el('h4', '', c.title)); if (c.dataset) head.appendChild(el('span', 'ax-ds', c.dataset));
  if (c.pack && S.explorer.cases.some(x => x.id === c.pack)) {const a = el('a', 'ax-to3d', 'View the action in 3D →'); a.onclick = () => goTo3D(c.pack); head.appendChild(a);}
  box.appendChild(head);
  const row = el('div', 'ax-row');
  for (const it of items) row.appendChild(clip(it.media, it.label, {note: it.note, accent: it.accent}));
  box.appendChild(row); justify(row, items.map(it => it.media), height); return box;
}
tabs($('#control-tabs'), $('#control-panel'), S.control.map(c => ({label: c.title, c})),
  ({c}) => rowPanel(c, [{media: c.observation, label: 'First frame'}, ...c.variants], 280));
tabs($('#compare-tabs'), $('#compare-panel'), S.comparison.map(c => ({label: c.title, c})), ({c}) => rowPanel(c, c.items, 320));
const mixtureBaselineLabels = ['Wan-Move', 'Cosmos-Predict2.5', 'Cosmos 3', 'ASTER'];
tabs($('#mixture-tabs'), $('#mixture-panel'), S.mixture.map(c => ({label: c.title, c})), ({c}) => {
  const items = c.items.map((item, index) => index === 0 ? item : {...item, label: mixtureBaselineLabels[index - 1]});
  const box = rowPanel(c, items, 240);
  box.appendChild(el('p', 'ax-warn', 'Same first frame and action across four video-generation baselines.'));
  return box;
});


/* ---------------------------------------------------------------- results wall */
// Justified rows: every clip keeps its own aspect, and each row is scaled to fill the width exactly, so a mix of
// portrait and widescreen results packs with no gaps and no cropping.
const mk = el;
function wall(box, items, {gap = 6} = {}) {
  const tiles = items.map(it => {
    const el = mk('figure', 'ax-tile'), v = vid(it.media);
    el.appendChild(v); el.appendChild(mk('figcaption', '', it.title));
    el.title = it.title; el.onclick = () => lightbox(it.media);
    box.appendChild(el);
    return {el, a: it.media.w / it.media.h};
  });
  const fit = () => {
    const W = box.clientWidth; if (!W) return;
    const target = W < 620 ? 104 : W < 900 ? 132 : 158;
    let row = [], sum = 0;
    const flush = last => {
      const h = Math.min((W - gap * (row.length - 1)) / sum, last ? target : Infinity);   // a short last row keeps the usual height instead of ballooning
      for (const t of row) {t.el.style.width = Math.floor(h * t.a) + 'px'; t.el.style.height = Math.round(h) + 'px';}
      row = []; sum = 0;
    };
    for (const t of tiles) {
      row.push(t); sum += t.a;
      if ((W - gap * (row.length - 1)) / sum <= target) flush(false);
    }
    if (row.length) flush(true);
  };
  new ResizeObserver(fit).observe(box); requestAnimationFrame(fit);
}
wall($('#wall'), S.gallery);

/* ---------------------------------------------------------------- generalization */
for (const a of S.generalization.alphabet) {
  const t = el('div', 't'); t.appendChild(vid(a.media)); t.appendChild(el('span', '', a.letter)); t.onclick = () => lightbox(a.media); $('#alphabet').appendChild(t);
}
const looks = {viewer: null};
tabs($('#look-tabs'), null, S.generalization.appearance.map(a => ({label: `Letter ${a.letter}`, a})), ({a}) => {
  const grid = $('#look-grid'); grid.querySelectorAll('video').forEach(v => onScreen.unobserve(v)); grid.innerHTML = '';
  for (const l of a.looks) grid.appendChild(clip(l.media, l.label, {accent: l.label === 'Standard'}));
  if (a.pack) {
    if (!looks.viewer) looks.viewer = new AsterViewer($('#look-viewer'), {flowWidth: 5, future: false, sourceView: true});
    looks.viewer.show(a.pack).then(() => looks.viewer.setTime(1));
  }
});
{
  const L = S.generalization.laser, box = $('#laser'), row = el('div', 'ax-row');
  for (const it of L.items) row.appendChild(clip(it.media, it.label));
  box.appendChild(row); box.appendChild(el('p', 'ax-warn', L.note));
  $('.ax-note').addEventListener('toggle', () => justify(row, L.items.map(i => i.media), 220), {once: true});
}

/* ---------------------------------------------------------------- analysis */
tabs($('#analysis-tabs'), $('#analysis-panel'), S.figures.analysis.map(a => ({label: a.name, a})), ({a}) => {
  const box = el('div', 'ax-ana'); box.appendChild(el('p', '', a.blurb)); const f = el('div', 'ax-fig'); figure(f, a.image); box.appendChild(f); return box;
});
