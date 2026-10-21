// loom live viewer. Plain browser JS; every view is rendered by the server, the same renderer the agent reads.
const $ = (id) => document.getElementById(id);
let state, sel = localStorage.getItem("loom.sel") || undefined, mode = localStorage.getItem("loom.mode") || "plane", node, tiles = 3, light, pending = false, queued = false;
const TABS = [["plane", "lit plane"], ["sphere", "sphere"], ["cube", "cube"], ["albedo", "albedo"], ["normal", "normal"], ["height", "height"], ["rough", "rough"], ["metal", "metal"], ["ao", "ao"], ["emit", "emit"]];
const view = $("view");

function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]); }
const info = () => state?.materials.find((m) => m.name === sel);
const flat = () => node || !["sphere", "cube"].includes(mode);

function viewUrl(w) {
  const k = flat() ? tiles : 1, v = state.version;
  if (node) return `/api/node?label=${encodeURIComponent(node)}&size=${w}&tiles=${k}&n=${Math.min(512, info()?.size ?? 256)}&v=${v}`;
  const m = TABS.slice(3).some(([t]) => t === mode) ? `mode=map&map=${mode}` : `mode=${mode}`;
  const l = light ? `&lx=${light[0].toFixed(3)}&ly=${light[1].toFixed(3)}` : "";
  return `/api/view?name=${encodeURIComponent(sel)}&${m}&size=${w}&tiles=${k}${l}&v=${v}`;
}

function draw() {
  const m = info();
  if (!m || m.error) return;
  if (pending) { queued = true; return; }
  pending = true;
  const st = $("stage"), size = Math.round(Math.min(st.clientWidth, st.clientHeight, 1000) * 0.96);
  const img = new Image();
  img.onload = () => { view.src = img.src; pending = false; drawMarks(); if (queued) { queued = false; draw(); } };
  img.onerror = () => { pending = false; };
  img.src = viewUrl(size);
}

function show() {
  const m = info();
  $("err").style.display = m?.error || state?.error ? "block" : "none";
  $("err").textContent = (state?.error ?? m?.error)?.message ?? "";
  $("tabs").innerHTML = "";
  for (const [t, label] of TABS) {
    const b = document.createElement("button");
    b.textContent = label; b.className = !node && mode === t ? "on" : "";
    b.onclick = () => { node = undefined; mode = t; localStorage.setItem("loom.mode", mode); show(); };
    $("tabs").appendChild(b);
  }
  $("tilebtn").textContent = tiles === 3 ? "3×3" : "1×1";
  if (!m || m.error) return;
  const seam = m.seam ? (m.seam.worst <= 1.5 ? `seamless (${m.seam.worst})` : `SEAM ${m.seam.worst}× in ${m.seam.map}`) : "";
  $("info").textContent = `${m.name} · ${m.size}×${m.size} · ${seam}${node ? ` · field "${node}"` : ""}`;
  $("meta").innerHTML = `${esc(m.name)} ${m.size}×${m.size}<br>${esc(seam)}<br><span style="opacity:.7">${esc(m.loc ?? "")}</span>`;
  $("hint").textContent = annotating ? (flat() ? "annotating: draw on the texture" : "annotate works on flat views: pick lit plane, a map or a field") : flat() && node ? "" : "drag to move the light";
  draw();
  if (annotating) renderAnnot();
}

function renderList() {
  const box = $("list");
  box.innerHTML = "";
  if (!state) return;
  const h = (t) => { const d = document.createElement("div"); d.className = "sect"; d.textContent = t; box.appendChild(d); };
  h("materials");
  for (const m of state.materials) {
    const row = document.createElement("div");
    row.className = "row" + (m.name === sel && !node ? " sel" : "");
    row.innerHTML = (m.error ? `<img alt="">` : `<img src="/api/view?name=${encodeURIComponent(m.name)}&mode=sphere&size=68&v=${state.version}">`) +
      `<span class="nm">${esc(m.name)}</span>` + (m.error ? `<span class="dot err"></span>` : m.changed && state.version > 1 ? `<span class="dot new"></span>` : "");
    row.onclick = () => { sel = m.name; node = undefined; localStorage.setItem("loom.sel", sel); renderList(); show(); };
    box.appendChild(row);
  }
  if (state.nodes.length) {
    h("named fields");
    for (const n of state.nodes) {
      const row = document.createElement("div");
      row.className = "row" + (n.label === node ? " sel" : "");
      row.title = n.loc ?? "";
      row.innerHTML = `<img src="/api/node?label=${encodeURIComponent(n.label)}&size=68&tiles=1&n=128&v=${state.version}"><span class="nm">${esc(n.label)}</span>`;
      row.onclick = () => { node = n.label; renderList(); show(); };
      box.appendChild(row);
    }
  }
}

// drag on the stage: aim the light (lit views)
let dragging = false;
const aim = (e) => {
  const r = view.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * 2 - 1, y = -(((e.clientY - r.top) / r.height) * 2 - 1);
  const l = Math.hypot(x, y), k = l > 0.95 ? 0.95 / l : 1;
  light = [x * k, y * k]; draw();
};
$("stage").onpointerdown = (e) => { if (annotating || node || ["albedo", "normal", "height", "rough", "metal", "ao", "emit"].includes(mode)) return; dragging = true; aim(e); };
$("stage").onpointermove = (e) => { if (dragging) aim(e); };
addEventListener("pointerup", () => { dragging = false; });
addEventListener("resize", () => { draw(); drawMarks(); });
$("tilebtn").onclick = () => { tiles = tiles === 3 ? 1 : 3; show(); };
addEventListener("keydown", (e) => {
  if (e.target.tagName === "TEXTAREA") return;
  if (e.key === "t") $("tilebtn").click();
  if (e.key === "a") setAnnotate(!annotating);
  if (annotating && "bne".includes(e.key)) { tool = e.key === "b" ? "pen" : e.key === "n" ? "note" : "erase"; renderAnnot(); }
});

const es = new EventSource("/events");
es.addEventListener("build", (e) => {
  const prev = state;
  state = JSON.parse(e.data);
  $("file").textContent = `${state.file}  v${state.version}  ${state.ms}ms`;
  const bad = state.error ? 1 : state.materials.filter((m) => m.error).length + state.errors.length;
  $("status").textContent = bad ? `${bad} error${bad > 1 ? "s" : ""}` : "ok";
  $("status").className = "pill " + (bad ? "bad" : "ok");
  if (!sel || !state.materials.some((m) => m.name === sel)) sel = state.materials[0]?.name;
  if (node && !state.nodes.some((n) => n.label === node)) node = undefined;
  const changed = prev && state.materials.find((m) => m.changed && !m.error);
  if (changed) sel = changed.name;
  $("pal").innerHTML = Object.entries(state.palette).map(([k, v]) => `<span data-c="${esc(v)}" title="click to paint with it"><i style="background:${v}"></i>${esc(k)}</span>`).join("");
  for (const el of $("pal").children) el.onclick = () => { if (!annotating) setAnnotate(true); pen = el.dataset.c; tool = "pen"; renderAnnot(); };
  renderList();
  show();
});
es.onerror = () => { $("status").textContent = "disconnected"; $("status").className = "pill bad"; };

// ---------------------------------------------------------------- annotate: feedback for Claude
// Marks are in texture pixels of the selected material; on a tiled view they appear on every copy.
const MARKUP = ["#ff3df0", "#2ee6ff", "#ffe14a", "#ffffff"], SIZES = [["thin", 2], ["medium", 5], ["thick", 10]];
const ann = $("ann"), g = ann.getContext("2d");
let annotating = false, tool = "pen", pen = MARKUP[0], sizeI = 0, stroke;

const mkey = () => "loom.marks." + sel;
function marks(create) {
  const n = info()?.size; if (!n) return undefined;
  let m; try { m = JSON.parse(localStorage.getItem(mkey()) || "null"); } catch {}
  if (m && m.n !== n) m = null;
  if (!m && create) m = { n, strokes: [], notes: [], comment: "" };
  return m || undefined;
}
const save = (m) => { try { localStorage.setItem(mkey(), JSON.stringify(m)); } catch {} };
function rect() { const r = view.getBoundingClientRect(), s = $("stage").getBoundingClientRect(); return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height }; }
/** Screen point -> texture pixel (wrapping across tiled copies). */
function toTex(e) {
  const r = view.getBoundingClientRect(), n = info().size, k = tiles;
  const u = ((e.clientX - r.left) / r.width) * k, v = ((e.clientY - r.top) / r.height) * k;
  return [Math.floor((((u % 1) + 1) % 1) * n), Math.floor((((v % 1) + 1) % 1) * n)];
}
function paint(c, m, w, h, k) {
  const sx = w / k / m.n, sy = h / k / m.n;
  for (let ty = 0; ty < k; ty++) for (let tx = 0; tx < k; tx++) {
    const ox = (tx * w) / k, oy = (ty * h) / k;
    for (const st of m.strokes) {
      c.strokeStyle = st.color; c.lineWidth = Math.max(1.5, st.width * sx); c.lineCap = c.lineJoin = "round"; c.globalAlpha = 0.9;
      c.beginPath();
      st.points.forEach(([x, y], i) => {
        const q = st.points[i - 1];
        if (!i || Math.abs(q[0] - x) > m.n / 2 || Math.abs(q[1] - y) > m.n / 2) c.moveTo(ox + (x + 0.5) * sx, oy + (y + 0.5) * sy);   // wrapped: lift the pen
        else c.lineTo(ox + (x + 0.5) * sx, oy + (y + 0.5) * sy);
      });
      c.stroke();
    }
    c.globalAlpha = 1; c.font = "700 12px ui-monospace, monospace"; c.textAlign = "center"; c.textBaseline = "middle";
    m.notes.forEach((q, i) => {
      const x = ox + (q.x + 0.5) * sx, y = oy + (q.y + 0.5) * sy;
      c.strokeStyle = "#ffb454"; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 4, 0, 7); c.stroke();
      c.fillStyle = "#ffb454"; c.beginPath(); c.arc(x + 11, y - 11, 9, 0, 7); c.fill();
      c.fillStyle = "#15131c"; c.fillText(String(i + 1), x + 11, y - 10);
    });
    c.textAlign = "start"; c.textBaseline = "alphabetic";
  }
}
function drawMarks() {
  const r = rect(), dpr = devicePixelRatio || 1;
  Object.assign(ann.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
  if (ann.width !== Math.round(r.w * dpr) || ann.height !== Math.round(r.h * dpr)) { ann.width = Math.round(r.w * dpr); ann.height = Math.round(r.h * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.w, r.h);
  const m = annotating && flat() && marks(false);
  if (m) paint(g, m, r.w, r.h, tiles);
}
function setAnnotate(on) {
  annotating = on;
  document.body.classList.toggle("annotating", on);
  $("annotbtn").classList.toggle("on", on);
  if (on && !flat()) { mode = "plane"; }
  show(); drawMarks();
}
function renderAnnot() {
  for (const t of ["pen", "note", "erase"]) $("t-" + t).classList.toggle("on", tool === t);
  $("t-size").textContent = SIZES[sizeI][0];
  $("colors").innerHTML = "";
  for (const c of MARKUP.concat(MARKUP.includes(pen) ? [] : [pen])) {
    const b = document.createElement("button");
    b.className = "chip" + (c === pen && tool === "pen" ? " on" : ""); b.style.background = c;
    b.onclick = () => { pen = c; tool = "pen"; renderAnnot(); };
    $("colors").appendChild(b);
  }
  const m = marks(false);
  $("notes").innerHTML = "";
  m?.notes.forEach((q, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<b>${i + 1}</b><span>${esc(q.text)}</span><a title="remove">×</a>`;
    li.lastChild.onclick = () => { m.notes.splice(i, 1); save(m); renderAnnot(); drawMarks(); };
    $("notes").appendChild(li);
  });
  $("comment").value = m?.comment ?? "";
}
ann.addEventListener("pointerdown", (e) => {
  if (!annotating || !flat()) return;
  const p = toTex(e), m = marks(true);
  if (tool === "erase") {
    const tol = Math.max(3, m.n / 80);
    const i = m.strokes.findIndex((s) => s.points.some(([x, y]) => Math.hypot(x - p[0], y - p[1]) < tol + s.width));
    if (i >= 0) { m.strokes.splice(i, 1); save(m); drawMarks(); }
    return;
  }
  if (tool === "note") {
    const text = prompt(`Note for Claude at pixel ${p[0]}, ${p[1]}:`);
    if (text && text.trim()) { m.notes.push({ x: p[0], y: p[1], text: text.trim() }); save(m); renderAnnot(); drawMarks(); }
    return;
  }
  stroke = { color: pen, width: SIZES[sizeI][1] * (m.n / 512), points: [p] };
  m.strokes.push(stroke); save(m);
  ann.setPointerCapture(e.pointerId);
});
ann.addEventListener("pointermove", (e) => {
  if (!stroke) return;
  const p = toTex(e), q = stroke.points[stroke.points.length - 1];
  if (p[0] !== q[0] || p[1] !== q[1]) { stroke.points.push(p); const m = marks(false); m.strokes[m.strokes.length - 1] = stroke; save(m); drawMarks(); }
});
ann.addEventListener("pointerup", () => { stroke = undefined; });
async function sendFeedback() {
  const m = marks(false), st = $("fbstatus");
  if (!m) { st.textContent = "nothing to send yet"; return; }
  const cv = document.createElement("canvas"); cv.width = view.naturalWidth; cv.height = view.naturalHeight;
  const c = cv.getContext("2d"); c.drawImage(view, 0, 0); paint(c, m, cv.width, cv.height, flat() ? tiles : 1);
  st.textContent = "sending…";
  const r = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: sel, strokes: m.strokes, notes: m.notes, comment: m.comment, annotated: cv.toDataURL("image/png") }) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  st.textContent = r.ok ? `sent ✓ ${j.summary} — tell Claude to check the feedback` : `not sent: ${j.error}`;
}
$("annotbtn").onclick = () => setAnnotate(!annotating);
$("t-pen").onclick = () => { tool = "pen"; renderAnnot(); };
$("t-note").onclick = () => { tool = "note"; renderAnnot(); };
$("t-erase").onclick = () => { tool = "erase"; renderAnnot(); };
$("t-size").onclick = () => { sizeI = (sizeI + 1) % SIZES.length; renderAnnot(); };
$("t-clear").onclick = () => { if (sel && confirm(`Clear all marks on ${sel}?`)) { localStorage.removeItem(mkey()); renderAnnot(); drawMarks(); } };
$("comment").oninput = () => { const m = marks(true); if (m) { m.comment = $("comment").value; save(m); } };
$("send").onclick = () => sendFeedback();
