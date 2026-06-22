/* ============================================================
   Qwen3-TTS Studio — frontend logic (vanilla JS, no build step)
   ============================================================ */
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
const icon = (id, cls = "") => `<svg class="${cls}"><use href="#${id}"/></svg>`;

const state = {
  mode: "custom",
  settings: {}, status: {}, history: [],
  voices: { builtin: [], custom: [], languages: [], design_presets: [] },
  resultItem: null,
};

const QUICK_EMOTIONS = [
  "Warm and friendly", "Calm documentary narrator", "Energetic and upbeat",
  "Serious and authoritative", "Soft and soothing", "Storytelling, expressive",
];

/* ---------- api ---------- */
async function _err(r){ try{ const j = await r.json(); return new Error(j.detail || r.statusText); }catch{ return new Error(r.statusText); } }
const api = {
  async get(u){ const r = await fetch(u); if(!r.ok) throw await _err(r); return r.json(); },
  async post(u,b){ const r = await fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}); if(!r.ok) throw await _err(r); return r.json(); },
  async put(u,b){ const r = await fetch(u,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}); if(!r.ok) throw await _err(r); return r.json(); },
  async del(u){ const r = await fetch(u,{method:"DELETE"}); if(!r.ok) throw await _err(r); return r.json(); },
  async form(u,fd){ const r = await fetch(u,{method:"POST",body:fd}); if(!r.ok) throw await _err(r); return r.json(); },
};
function pollJob(id, onProgress){
  return new Promise((resolve, reject) => {
    const t = setInterval(async () => {
      try {
        const j = await api.get("/api/jobs/" + id);
        onProgress && onProgress(j);
        if (j.status === "done"){ clearInterval(t); resolve(j.result || {}); }
        else if (j.status === "error"){ clearInterval(t); reject(new Error(j.error || "Job failed")); }
      } catch(e){ clearInterval(t); reject(e); }
    }, 600);
  });
}

/* ---------- helpers ---------- */
const pad = n => String(n).padStart(2, "0");
function fmtDur(s){ s = Math.max(0, Math.round(s||0)); return `${Math.floor(s/60)}:${pad(s%60)}`; }
const dispName = id => (id || "").replace(/_/g, " ");
function toast(msg, kind="ok"){
  const t = el("div", `toast ${kind}`, `${icon(kind==="err"?"i-x":"i-check")}<span>${msg}</span>`);
  $("#toasts").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = ".4s"; setTimeout(()=>t.remove(), 400); }, kind==="err"?4200:2600);
}

/* light client-side chunk preview (server does the authoritative split) */
function previewChunks(text, max){
  const out = [];
  text.replace(/\r\n?/g,"\n").split(/\n\s*\n+/).forEach(para => {
    const p = para.replace(/\s+/g," ").trim();
    if(!p) return;
    const sents = p.match(/[^.!?。！？…]+[.!?。！？…]*\s*/g) || [p];
    let buf = "";
    sents.forEach(s => {
      s = s.trim(); if(!s) return;
      if(buf && (buf.length + s.length + 1) > max){ out.push(buf); buf = s; }
      else buf = buf ? buf + " " + s : s;
    });
    if(buf) out.push(buf);
  });
  return out;
}

/* ---------- router ---------- */
function showView(name){
  $$(".nav-item").forEach(b => b.classList.toggle("is-active", b.dataset.view === name));
  $$(".view").forEach(v => v.classList.toggle("is-active", v.dataset.view === name));
  if(name === "voices") renderVoices();
  if(name === "history") renderHistory();
  if(name === "settings") renderSettings();
}
$("#nav").addEventListener("click", e => { const b = e.target.closest(".nav-item"); if(b) showView(b.dataset.view); });

/* ---------- chips ---------- */
function renderChips(){
  const s = state.status;
  $("#chipDevice").textContent = (s.device === "dml" ? "GPU · DirectML" : "CPU");
  $("#chipModel").textContent = "Qwen3-TTS " + (s.model_size || "1.7B");
  $("#chipFfmpeg").hidden = s.ffmpeg !== false;
}

/* ============================================================
   STUDIO
   ============================================================ */
const scriptInput = $("#scriptInput");
const voiceSelect = $("#voiceSelect");
const languageSelect = $("#languageSelect");
const instructInput = $("#instructInput");
const generateBtn = $("#generateBtn");
const wave = $("#wave");
const stageText = $("#stageText");

function populateLanguages(){
  languageSelect.innerHTML = state.voices.languages
    .map(l => `<option value="${l}">${l === "Auto" ? "Auto-detect" : l}</option>`).join("");
  languageSelect.value = state.settings.default_language || "Auto";
}

function populateVoices(){
  if(state.mode === "custom"){
    voiceSelect.innerHTML = state.voices.builtin
      .map(v => `<option value="${v.id}">${dispName(v.id)} — ${v.native}${v.youtube?" ★":""}</option>`).join("");
    voiceSelect.value = state.settings.default_speaker || "Ryan";
  } else {
    const cs = state.voices.custom;
    if(!cs.length){
      voiceSelect.innerHTML = `<option value="">No custom voices yet — create one in Voices</option>`;
    } else {
      voiceSelect.innerHTML = cs.map(v => `<option value="${v.id}">${v.name} (${v.type})</option>`).join("");
    }
  }
  updateVoiceHint();
  updateInstructVisibility();
}
function updateVoiceHint(){
  const hint = $("#voiceHint");
  if(state.mode === "custom"){
    const v = state.voices.builtin.find(x => x.id === voiceSelect.value);
    hint.textContent = v ? v.desc : "";
  } else {
    const v = state.voices.custom.find(x => x.id === voiceSelect.value);
    hint.textContent = v ? (v.type === "design" ? `Designed: ${v.instruct?.slice(0,80) || ""}` : "Cloned voice") : "";
  }
}
function updateInstructVisibility(){
  // emotion/style only applies to built-in voices on the 1.7B model
  const is17 = (state.settings.model_size || "1.7B") === "1.7B";
  const show = state.mode === "custom";
  $("#instructField").style.display = show ? "" : "none";
  $("#quickEmotions").style.display = show ? "" : "none";
  if(show){
    const hint = $("#instructField .field-hint");
    hint.textContent = is17 ? "Natural-language delivery control (1.7B model)."
      : "Switch to the 1.7B model in Settings to enable emotion control.";
    instructInput.disabled = !is17;
  }
}

function renderQuickEmotions(){
  const box = $("#quickEmotions");
  box.innerHTML = "";
  QUICK_EMOTIONS.forEach(e => {
    const c = el("button", "emo-chip", e);
    c.onclick = () => { instructInput.value = e; };
    box.appendChild(c);
  });
}

function updateScriptMeta(){
  const text = scriptInput.value;
  const words = (text.trim().match(/\S+/g) || []).length;
  const chars = text.replace(/\s/g, "").length;
  const est = words / 150 * 60; // ~150 wpm narration
  $("#scriptMeta").innerHTML = `<span>${words} words</span><span>${chars} chars</span><span>~${fmtDur(est)}</span>`;
  const bar = $("#chunkBar");
  if(!text.trim()){ bar.hidden = true; return; }
  const chunks = previewChunks(text, state.settings.max_chars || 240);
  bar.hidden = false;
  const shown = chunks.slice(0, 14);
  bar.innerHTML = `<span class="chunk-pill" style="border-color:rgba(230,169,75,.3);color:var(--accent)">${chunks.length} chunk${chunks.length>1?"s":""}</span>`
    + shown.map(c => `<span class="chunk-pill" title="${c.replace(/"/g,"&quot;")}">${c.slice(0,22)}${c.length>22?"…":""}</span>`).join("")
    + (chunks.length > shown.length ? `<span class="chunk-pill">+${chunks.length - shown.length} more</span>` : "");
}

/* ----- generation ----- */
let running = false;
function setRunning(on, msg, isErr){
  running = on;
  generateBtn.disabled = on;
  wave.classList.toggle("is-active", on);
  $(".bg-label").textContent = on ? "Rendering…" : "Generate narration";
  stageText.textContent = msg || (on ? "Working…" : "Idle · ready to render");
  stageText.className = "stage-text" + (on ? " run" : "") + (isErr ? " err" : "");
}
function setStage(j){
  const pct = Math.round((j.progress || 0) * 100);
  stageText.textContent = `${j.stage || "Working"} · ${pct}%`;
}

async function generate(){
  if(running) return;
  const text = scriptInput.value.trim();
  if(!text){ toast("Write or paste a script first.", "err"); scriptInput.focus(); return; }
  const body = { mode: state.mode, text, language: languageSelect.value };
  if(state.mode === "custom"){
    body.speaker = voiceSelect.value;
    body.instruct = instructInput.value.trim() || null;
  } else {
    if(!voiceSelect.value){ toast("Create or pick a custom voice first.", "err"); return; }
    body.voice_id = voiceSelect.value;
  }
  setRunning(true, "Queued…");
  try {
    const { job_id } = await api.post("/api/tts", body);
    const res = await pollJob(job_id, setStage);
    const item = res.item;
    state.history.unshift(item);
    showResult(item);
    setRunning(false, `Done · ${fmtDur(item.duration)} of audio`);
    toast("Narration ready.", "ok");
  } catch(e){
    setRunning(false, "Error: " + e.message, true);
    toast(e.message, "err");
  }
}
generateBtn.addEventListener("click", generate);

/* ----- result player ----- */
const audio = $("#audio");
function showResult(item){
  state.resultItem = item;
  const file = item.files.mp3 || item.files.wav;
  if(!file){ toast("No audio file produced.", "err"); return; }
  setSource("/audio/" + file, true);
  $("#result").hidden = false;
  $("#resultTitle").textContent = `${item.voice} · ${item.language === "Auto" ? "auto" : item.language} · ${fmtDur(item.duration)}`;
  const dl = $("#dlGroup"); dl.innerHTML = "";
  Object.entries(item.files).forEach(([kind, name]) => {
    const a = el("a", "dl-btn", `${icon("i-download")}<span>${kind.toUpperCase()}</span>`);
    a.href = "/download/" + name; a.download = "";
    dl.appendChild(a);
  });
  $("#result").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
let resultIsSource = false;
function setSource(url, asResult){
  resultIsSource = !!asResult;
  audio.src = url;
  audio.play().catch(()=>{});
}
const playBtn = $("#playBtn");
playBtn.addEventListener("click", () => { if(audio.paused) audio.play(); else audio.pause(); });
function syncPlayIcon(){
  const playing = !audio.paused && !audio.ended;
  $(".ic-play", playBtn).hidden = playing;
  $(".ic-pause", playBtn).hidden = !playing;
}
audio.addEventListener("play", syncPlayIcon);
audio.addEventListener("pause", syncPlayIcon);
audio.addEventListener("ended", syncPlayIcon);
audio.addEventListener("loadedmetadata", () => { if(resultIsSource) $("#durTime").textContent = fmtDur(audio.duration); });
audio.addEventListener("timeupdate", () => {
  if(!resultIsSource) return;
  const pct = audio.duration ? (audio.currentTime / audio.duration * 100) : 0;
  $("#scrubFill").style.width = pct + "%";
  $("#curTime").textContent = fmtDur(audio.currentTime);
});
$("#scrub").addEventListener("click", e => {
  if(!audio.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  audio.currentTime = (e.clientX - r.left) / r.width * audio.duration;
});

/* mode toggle */
$("#modeSeg").addEventListener("click", e => {
  const b = e.target.closest(".seg-btn"); if(!b) return;
  state.mode = b.dataset.mode;
  $$("#modeSeg .seg-btn").forEach(x => x.classList.toggle("is-active", x === b));
  populateVoices();
});
voiceSelect.addEventListener("change", updateVoiceHint);
scriptInput.addEventListener("input", updateScriptMeta);

/* ============================================================
   VOICES
   ============================================================ */
function voiceCard(v){
  const tags = [];
  if(v.youtube) tags.push(`<span class="tag gold">YouTube pick</span>`);
  tags.push(`<span class="tag">${v.gender}</span>`);
  tags.push(`<span class="tag teal">${v.native}</span>`);
  const card = el("div", "vcard");
  card.innerHTML = `
    <div class="vcard-head">
      <button class="vc-play" title="Preview">${icon("i-play")}</button>
      <div><div class="vcard-name">${dispName(v.id)}</div><div class="vcard-sub">Built-in</div></div>
    </div>
    <div class="vcard-desc">${v.desc}</div>
    <div class="vcard-tags">${tags.join("")}</div>`;
  $(".vc-play", card).onclick = () => previewVoice(v.id, null, $(".vc-play", card));
  return card;
}
function customCard(v){
  const card = el("div", "vcard");
  card.innerHTML = `
    <div class="vcard-head">
      <button class="vc-play" title="Preview">${icon("i-play")}</button>
      <div><div class="vcard-name">${v.name}</div><div class="vcard-sub">${v.type === "design" ? "Designed voice" : "Cloned voice"}</div></div>
    </div>
    <div class="vcard-desc">${v.type === "design" ? (v.instruct || "") : "Cloned from your sample. Use it for narration in the Studio."}</div>
    <div class="vcard-tags"><span class="tag teal">${v.language}</span></div>
    <div class="vcard-actions">
      <button class="mini-btn use">${icon("i-studio")}Use</button>
      <button class="mini-btn danger del">${icon("i-trash")}Delete</button>
    </div>`;
  $(".vc-play", card).onclick = () => previewVoice(null, v.id, $(".vc-play", card));
  $(".use", card).onclick = () => { state.mode = "clone"; $$("#modeSeg .seg-btn").forEach(x => x.classList.toggle("is-active", x.dataset.mode === "clone")); populateVoices(); voiceSelect.value = v.id; updateVoiceHint(); showView("studio"); toast(`Using “${v.name}” in Studio.`); };
  $(".del", card).onclick = async () => {
    if(!confirm(`Delete voice “${v.name}”?`)) return;
    try { await api.del("/api/voices/" + v.id); state.voices.custom = state.voices.custom.filter(x => x.id !== v.id); renderVoices(); populateVoices(); toast("Voice deleted."); }
    catch(e){ toast(e.message, "err"); }
  };
  return card;
}
function renderVoices(){
  const bg = $("#builtinVoiceGrid"); bg.innerHTML = "";
  state.voices.builtin.forEach(v => bg.appendChild(voiceCard(v)));
  const cg = $("#customVoiceGrid"); cg.innerHTML = "";
  $("#myVoicesTitle").hidden = state.voices.custom.length === 0;
  state.voices.custom.forEach(v => cg.appendChild(customCard(v)));
}

async function previewVoice(speaker, voiceId, btn){
  if(btn) btn.classList.add("loading");
  const body = { preview: true, language: languageSelect.value || "English" };
  if(speaker){ body.mode = "custom"; body.speaker = speaker; body.text = ""; }
  else { body.mode = "clone"; body.voice_id = voiceId; body.text = ""; }
  // server fills preview text when empty? no — send a real line
  body.text = previewLine(body.language);
  try {
    const { job_id } = await api.post("/api/tts", body);
    const res = await pollJob(job_id);
    const file = res.item.files.mp3 || res.item.files.wav;
    setSource("/audio/" + file, false);
  } catch(e){ toast(e.message, "err"); }
  finally { if(btn) btn.classList.remove("loading"); }
}
function previewLine(lang){
  const m = {
    English:"Hey everyone, welcome back to the channel. Let's get straight into it.",
    Chinese:"大家好，欢迎回到我的频道，我们马上开始吧。",
    Japanese:"皆さん、こんにちは。チャンネルへようこそ。",
    Korean:"여러분 안녕하세요, 채널에 오신 것을 환영합니다.",
    German:"Hallo zusammen und willkommen zurück auf dem Kanal.",
    French:"Salut tout le monde, bienvenue sur la chaîne.",
    Spanish:"Hola a todos, bienvenidos de nuevo al canal.",
  };
  return m[lang] || m.English;
}

/* ----- clone modal ----- */
function openModal(html){ $("#modalCard").innerHTML = html; $("#modal").hidden = false; }
function closeModal(){ $("#modal").hidden = true; $("#modalCard").innerHTML = ""; }
$("#modal").addEventListener("click", e => { if(e.target.id === "modal") closeModal(); });

function langOptions(sel){ return state.voices.languages.map(l => `<option ${l===sel?"selected":""} value="${l}">${l==="Auto"?"Auto-detect":l}</option>`).join(""); }

$("#openClone").addEventListener("click", () => {
  openModal(`
    <div class="modal-head"><h2>Clone a voice</h2><button class="icon-btn" id="mClose">${icon("i-x")}</button></div>
    <div class="modal-body">
      <p class="ghint" style="color:var(--muted);margin:0">Upload <b>10–20 seconds</b> of clean, single-speaker speech (WAV/MP3/M4A). For best results, add the exact transcript.</p>
      <div class="drop" id="drop">${icon("i-upload")}<div>Click or drop an audio file</div><div class="fname" id="fname"></div></div>
      <input type="file" id="fileInput" accept="audio/*" hidden />
      <label class="field"><span class="field-label">Voice name</span><input class="input" id="cName" placeholder="My narrator voice" /></label>
      <label class="field"><span class="field-label">Transcript <em class="opt">recommended</em></span><textarea class="input" id="cText" placeholder="Type exactly what is said in the sample…"></textarea></label>
      <label class="field"><span class="field-label">Primary language</span><select class="select" id="cLang">${langOptions("English")}</select></label>
      <div class="modal-foot"><button class="btn" id="mCancel">Cancel</button><button class="btn primary" id="cSubmit">Create voice</button></div>
    </div>`);
  let file = null;
  const drop = $("#drop"), fi = $("#fileInput");
  drop.onclick = () => fi.click();
  fi.onchange = () => { file = fi.files[0]; if(file) $("#fname").textContent = file.name; };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); file = e.dataTransfer.files[0]; if(file) $("#fname").textContent = file.name; };
  $("#mClose").onclick = closeModal; $("#mCancel").onclick = closeModal;
  $("#cSubmit").onclick = async () => {
    if(!file){ toast("Choose an audio file.", "err"); return; }
    const fd = new FormData();
    fd.append("file", file); fd.append("name", $("#cName").value || "My voice");
    fd.append("ref_text", $("#cText").value || ""); fd.append("language", $("#cLang").value);
    const btn = $("#cSubmit"); btn.disabled = true; btn.textContent = "Processing…";
    try {
      const { voice } = await api.form("/api/voices/clone", fd);
      state.voices.custom.unshift(voice);
      closeModal(); renderVoices(); populateVoices();
      toast("Voice cloned — try it in the Studio.", "ok");
    } catch(e){ toast(e.message, "err"); btn.disabled = false; btn.textContent = "Create voice"; }
  };
});

$("#openDesign").addEventListener("click", () => {
  const presets = state.voices.design_presets.map(p => `<button class="preset-chip" data-i="${p.instruct.replace(/"/g,"&quot;")}">${p.name}</button>`).join("");
  openModal(`
    <div class="modal-head"><h2>Design a voice</h2><button class="icon-btn" id="mClose">${icon("i-x")}</button></div>
    <div class="modal-body">
      <p class="ghint" style="color:var(--muted);margin:0">Describe the voice you want in plain language. It’s rendered, then saved as a reusable voice. <b>Requires the 1.7B model.</b></p>
      <label class="field"><span class="field-label">Voice name</span><input class="input" id="dName" placeholder="Documentary narrator" /></label>
      <label class="field"><span class="field-label">Describe the voice</span><textarea class="input" id="dInstruct" placeholder="A calm, warm middle-aged male narrator with a deep resonant voice and measured pacing…"></textarea></label>
      <div class="preset-row">${presets}</div>
      <label class="field"><span class="field-label">Sample line <em class="opt">optional</em></span><input class="input" id="dText" placeholder="Leave blank to use a default line" /></label>
      <label class="field"><span class="field-label">Language</span><select class="select" id="dLang">${langOptions("English")}</select></label>
      <div class="stage-text" id="dStage" style="min-height:16px"></div>
      <div class="modal-foot"><button class="btn" id="mCancel">Cancel</button><button class="btn primary" id="dSubmit">${icon("i-spark")} Create voice</button></div>
    </div>`);
  $("#mClose").onclick = closeModal; $("#mCancel").onclick = closeModal;
  $$(".preset-chip").forEach(c => c.onclick = () => { $("#dInstruct").value = c.dataset.i; });
  $("#dSubmit").onclick = async () => {
    const instruct = $("#dInstruct").value.trim();
    if(!instruct){ toast("Describe the voice first.", "err"); return; }
    const btn = $("#dSubmit"); btn.disabled = true;
    const stage = $("#dStage"); stage.className = "stage-text run";
    try {
      const { job_id } = await api.post("/api/design", {
        name: $("#dName").value || "Designed voice", instruct,
        preview_text: $("#dText").value || null, language: $("#dLang").value });
      const res = await pollJob(job_id, j => stage.textContent = `${j.stage} · ${Math.round(j.progress*100)}%`);
      state.voices.custom.unshift(res.voice);
      closeModal(); renderVoices(); populateVoices();
      toast("Voice designed and saved.", "ok");
    } catch(e){ stage.className = "stage-text err"; stage.textContent = e.message; btn.disabled = false; }
  };
});

/* ============================================================
   HISTORY
   ============================================================ */
function renderHistory(){
  const list = $("#historyList"); list.innerHTML = "";
  const items = state.history.filter(h => !h.preview);
  $("#historyEmpty").hidden = items.length > 0;
  items.forEach(item => {
    const file = item.files?.mp3 || item.files?.wav;
    const row = el("div", "hrow");
    const when = new Date((item.created||0)*1000).toLocaleString();
    row.innerHTML = `
      <button class="h-play">${icon("i-play")}</button>
      <div class="h-body">
        <div class="h-title">${item.text_preview || "(no text)"}</div>
        <div class="h-meta"><span>${item.voice}</span><span>${fmtDur(item.duration)}</span><span>${item.chars} chars</span><span>${when}</span></div>
      </div>
      <div class="h-actions"></div>`;
    $(".h-play", row).onclick = () => { if(file) setSource("/audio/" + file, false); };
    const acts = $(".h-actions", row);
    Object.entries(item.files || {}).forEach(([kind, name]) => {
      const a = el("a", "icon-btn", icon("i-download")); a.href = "/download/" + name; a.title = "Download " + kind.toUpperCase();
      acts.appendChild(a);
    });
    const del = el("button", "icon-btn danger", icon("i-trash")); del.title = "Delete";
    del.onclick = async () => { try { await api.del("/api/history/" + item.id); state.history = state.history.filter(h => h.id !== item.id); renderHistory(); } catch(e){ toast(e.message, "err"); } };
    acts.appendChild(del);
    list.appendChild(row);
  });
}

/* ============================================================
   SETTINGS
   ============================================================ */
async function patchSettings(patch){
  try { state.settings = await api.put("/api/settings", patch); }
  catch(e){ toast(e.message, "err"); }
}
function seg(options, value, onPick){
  const wrap = el("div", "seg small");
  options.forEach(([val, label]) => {
    const b = el("button", "seg-btn" + (val === value ? " is-active" : ""), label);
    b.onclick = () => onPick(val);
    wrap.appendChild(b);
  });
  return wrap;
}
function toggle(value, onToggle){
  const t = el("button", "toggle" + (value ? " on" : ""));
  t.onclick = () => onToggle(!value);
  return t;
}
function numCtl(value, onChange, attrs={}){
  const i = el("input"); i.type = "number"; i.className = "input"; i.value = value;
  Object.entries(attrs).forEach(([k,v]) => i.setAttribute(k, v));
  i.onchange = () => onChange(parseFloat(i.value));
  return i;
}
function row(label, sub, ctl){
  const r = el("div", "srow");
  r.innerHTML = `<div><label>${label}</label>${sub?`<small>${sub}</small>`:""}</div>`;
  const c = el("div", "ctl"); c.appendChild(ctl); r.appendChild(c);
  return r;
}

async function renderSettings(){
  await refreshStatus();
  const s = state.settings, grid = $("#settingsGrid");
  grid.innerHTML = "";

  /* engine */
  const g1 = el("div", "sgroup", `<h3>Engine</h3><p class="ghint">Bigger model = more natural & expressive, but slower on CPU.</p>`);
  g1.appendChild(row("Model size", "0.6B is faster; 1.7B adds emotion control & voice design",
    seg([["1.7B","1.7B · quality"],["0.6B","0.6B · fast"]], s.model_size, async v => { await patchSettings({model_size:v}); afterSettingsChange(); renderSettings(); })));
  g1.appendChild(row("Compute device", "AMD GPU (DirectML) was tested but can't run this model's generation loop, so synthesis uses the CPU.",
    el("span", "", '<span class="dot on"></span>CPU')));
  g1.appendChild(row("Models in RAM", "How many task models stay loaded (LRU)",
    numCtl(s.max_loaded_models, v => patchSettings({max_loaded_models:Math.max(1,Math.round(v))}), {min:1,max:3,step:1})));
  grid.appendChild(g1);

  /* audio */
  const g2 = el("div", "sgroup", `<h3>Audio output</h3><p class="ghint">Loudness & pacing for YouTube-ready files.</p>`);
  g2.appendChild(row("Format", "", seg([["mp3","MP3"],["wav","WAV"],["both","Both"]], s.output_format, v => patchSettings({output_format:v}))));
  g2.appendChild(row("Loudness normalize", `Target ${s.loudnorm_i} LUFS (YouTube ≈ −14)`, toggle(s.loudnorm, v => { patchSettings({loudnorm:v}); renderSettings(); })));
  g2.appendChild(row("Loudness target (LUFS)", "", numCtl(s.loudnorm_i, v => patchSettings({loudnorm_i:v}), {min:-30,max:-8,step:0.5})));
  g2.appendChild(row("Sentence gap (ms)", "Pause between sentences", numCtl(s.gap_ms, v => patchSettings({gap_ms:Math.round(v)}), {min:0,max:1500,step:10})));
  g2.appendChild(row("Paragraph gap (ms)", "Pause between paragraphs", numCtl(s.paragraph_gap_ms, v => patchSettings({paragraph_gap_ms:Math.round(v)}), {min:0,max:3000,step:10})));
  g2.appendChild(row("Trim dead air", "Trim silence at chunk edges", toggle(s.trim_silence, v => patchSettings({trim_silence:v}))));
  grid.appendChild(g2);

  /* defaults */
  const g3 = el("div", "sgroup", `<h3>Defaults & quality</h3><p class="ghint">Starting voice and synthesis parameters.</p>`);
  const spkSel = el("select", "select", state.voices.builtin.map(v => `<option value="${v.id}" ${v.id===s.default_speaker?"selected":""}>${dispName(v.id)}</option>`).join(""));
  spkSel.onchange = () => patchSettings({default_speaker:spkSel.value});
  g3.appendChild(row("Default voice", "", spkSel));
  const langSel = el("select", "select", langOptions(s.default_language));
  langSel.onchange = () => patchSettings({default_language:langSel.value});
  g3.appendChild(row("Default language", "", langSel));
  g3.appendChild(row("Max chars / chunk", "Lower = shorter, safer clips", numCtl(s.max_chars, v => { patchSettings({max_chars:Math.round(v)}); updateScriptMeta(); }, {min:80,max:500,step:10})));
  const samp = s.sampling || {};
  g3.appendChild(row("Temperature", "Higher = more varied delivery", numCtl(samp.temperature, v => patchSettings({sampling:{temperature:v}}), {min:0.1,max:1.5,step:0.05})));
  g3.appendChild(row("Repetition penalty", "", numCtl(samp.repetition_penalty, v => patchSettings({sampling:{repetition_penalty:v}}), {min:1,max:1.5,step:0.01})));
  grid.appendChild(g3);

  /* models on disk */
  const g4 = el("div", "sgroup", `<h3>Local models</h3><p class="ghint">Weights live in <code style="font-family:var(--font-mono);font-size:11px">./models</code>. First use downloads them.</p>`);
  const st = state.status;
  g4.appendChild(row("ffmpeg", st.ffmpeg ? "Detected" : "Not found — install for MP3/loudness", el("span", "", st.ffmpeg ? `<span class="dot on"></span>OK` : `<span class="dot off"></span>missing`)));
  Object.entries(st.tasks || {}).forEach(([task, info]) => {
    const r = el("div", "model-state");
    r.innerHTML = `<div><span class="dot ${info.cached?"on":"off"}"></span>${task}<div class="ms-name">${info.repo}</div></div>`;
    if(info.cached){ r.appendChild(el("span", "", `${info.loaded?"loaded":"on disk"}`)); }
    else { const b = el("button", "ghost-btn", "Download"); b.onclick = () => downloadModel(task, b); r.appendChild(b); }
    g4.appendChild(r);
  });
  grid.appendChild(g4);
}
function afterSettingsChange(){ renderChips(); populateVoices(); updateScriptMeta(); }
async function downloadModel(task, btn){
  btn.disabled = true; btn.textContent = "Downloading…";
  try {
    const { job_id } = await api.post("/api/preload", { task });
    await pollJob(job_id, j => btn.textContent = `${Math.round(j.progress*100)}%`);
    toast(`${task} model ready.`, "ok"); await refreshStatus(); renderSettings();
  } catch(e){ toast(e.message, "err"); btn.disabled = false; btn.textContent = "Download"; }
}
async function refreshStatus(){ try { state.status = await api.get("/api/status"); renderChips(); } catch{} }

/* ============================================================
   BOOT
   ============================================================ */
async function boot(){
  try {
    const b = await api.get("/api/bootstrap");
    state.settings = b.settings; state.status = b.status;
    state.voices = b.voices; state.history = b.history || [];
  } catch(e){ toast("Could not reach the backend: " + e.message, "err"); return; }
  // assign staggered animation indices to wave bars
  $$("#wave span").forEach((s, i) => s.style.setProperty("--i", i));
  renderChips();
  populateLanguages();
  populateVoices();
  renderQuickEmotions();
  updateScriptMeta();
  syncPlayIcon();
  // poll status until torch warms up (so model chips/cached states are fresh)
  if(!state.status.torch_ready) setTimeout(refreshStatus, 4000);
}
boot();
