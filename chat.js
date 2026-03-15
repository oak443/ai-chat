// ── Marked + math protection ───────────────
const renderer = new marked.Renderer();
renderer.code = (code, lang) => {
  const safeLang = (lang || "").replace(/[<>"'&]/g, "");
  const hl =
    safeLang && hljs.getLanguage(safeLang)
      ? hljs.highlight(code, { language: safeLang }).value
      : hljs.highlightAuto(code).value;
  return `<pre><div class="code-header"><span class="code-lang">${safeLang}</span><button class="copy-btn" onclick="copyCode(this)">复制</button></div><code class="hljs">${hl}</code></pre>`;
};

// Auto-wrap bare LaTeX source blocks that aren't in a code fence
function autoWrapLatex(src) {
  const segs = [];
  let last = 0;
  const fenceRe = /^(`{3,}|~{3,})[ \t]*\w*\n[\s\S]*?\n\1[ \t]*$/gm;
  let fm;
  while ((fm = fenceRe.exec(src)) !== null) {
    if (fm.index > last)
      segs.push({
        t: src.slice(last, fm.index),
        code: false,
      });
    segs.push({ t: fm[0], code: true });
    last = fm.index + fm[0].length;
  }
  if (last < src.length) segs.push({ t: src.slice(last), code: false });
  return segs
    .map((seg) => {
      if (seg.code) return seg.t;
      let t = seg.t;
      // Full LaTeX document: \documentclass ... \end{document}
      const ds = t.indexOf("\\documentclass"),
        de = t.indexOf("\\end{document}");
      if (ds !== -1 && de > ds) {
        return (
          t.slice(0, ds) +
          "```latex\n" +
          t.slice(ds, de + 15) +
          "\n```" +
          t.slice(de + 15)
        );
      }
      // Standalone LaTeX environments that break markdown (tabular, table, align, etc.)
      const envs =
        "tabular|longtable|table|align|aligned|gather|multline|array|tikzpicture|lstlisting|verbatim|figure|itemize|enumerate";
      t = t.replace(
        new RegExp(
          `(\\\\begin\\{(?:${envs})[^}]*\\}[\\s\\S]*?\\\\end\\{(?:${envs})[^}]*\\})`,
          "g",
        ),
        (m) => "```latex\n" + m + "\n```",
      );
      return t;
    })
    .join("");
}

const MATH_PH = "MTHPH_";
const CODE_PH = "CDPH_";
function protectMath(src) {
  const mathMap = [],
    codeMap = [];
  src = autoWrapLatex(src);
  // Protect fenced code blocks
  src = src.replace(/^(`{3,})([\s\S]*?)^\1/gm, (m) => {
    codeMap.push(m);
    return `${CODE_PH}${codeMap.length - 1}__`;
  });
  // Protect inline code
  src = src.replace(/`[^`\n]+`/g, (m) => {
    codeMap.push(m);
    return `${CODE_PH}${codeMap.length - 1}__`;
  });
  // Display math $$...$$
  src = src.replace(/\$\$([\s\S]+?)\$\$/g, (m) => {
    mathMap.push({ raw: m, display: true });
    return `${MATH_PH}${mathMap.length - 1}__`;
  });
  // Inline math $...$
  src = src.replace(/\$([^\n$][^$\n]*?[^\n$\s]|\S)\$/g, (m) => {
    mathMap.push({ raw: m, display: false });
    return `${MATH_PH}${mathMap.length - 1}__`;
  });
  // Restore code blocks for marked to process normally
  src = src.replace(
    new RegExp(`${CODE_PH}(\\d+)__`, "g"),
    (_, i) => codeMap[+i],
  );
  return { src, mathMap };
}
function restoreMath(html, mathMap) {
  return html.replace(new RegExp(`${MATH_PH}(\\d+)__`, "g"), (_, i) => {
    const { raw, display } = mathMap[+i];
    return display ? `<div class="math-display-wrap">${raw}</div>` : raw;
  });
}
function mdToHtml(raw) {
  const { src, mathMap } = protectMath(raw);
  marked.setOptions({ breaks: true, gfm: true });
  marked.use({ renderer });
  return restoreMath(marked.parse(src), mathMap);
}
function copyCode(btn) {
  navigator.clipboard
    .writeText(btn.closest("pre").querySelector("code").innerText)
    .then(() => {
      btn.textContent = "✓";
      setTimeout(() => (btn.textContent = "复制"), 1500);
    });
}
// _mathDone guard: prevent double-typeset causing ghost formulas
function renderMath(el) {
  if (el._mathDone) return;
  el._mathDone = true;
  if (window.MathJax)
    MathJax.typesetPromise([el]).catch((e) => console.warn("MathJax error", e));
}

// ── Theme toggle ───────────────────────────
// FIX: 默认深色，只有明确存了 'light' 才切浅色
const themeBtn = document.getElementById("theme-btn");
let isDark = localStorage.getItem("theme") === "dark"; // 默认浅色
function applyTheme() {
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  themeBtn.textContent = isDark ? "☀ 浅色" : "🌙 深色";
  localStorage.setItem("theme", isDark ? "dark" : "light");
}
themeBtn.addEventListener("click", () => {
  isDark = !isDark;
  applyTheme();
});
applyTheme();

// ── Personas ───────────────────────────────
const PERSONAS = {
  default: "",
  neko: '你是一只傲娇的猫娘，说话时偶尔会加上"喵"，但嘴硬心软。无论用户说什么，你都会假装不在意，但实际上非常关心对方。不要打破这个人设。',
};
let currentPersona = localStorage.getItem("persona") || "default";

// ── Constants ──────────────────────────────
const API_HEADERS = {
  "Content-Type": "application/json",
  "ngrok-skip-browser-warning": "1",
};
const STORAGE_KEY = "ai_chat_v3";

// ── DOM refs ───────────────────────────────
const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const modelSelect = document.getElementById("model-select");
const imgBtn = document.getElementById("img-btn");
const imgFile = document.getElementById("img-file");
const previewStrip = document.getElementById("image-preview-strip");
const clearBtn = document.getElementById("clear-btn");
const inputWrapper = document.getElementById("input-wrapper");

// ── Background music ───────────────────────
const musicBtn = document.getElementById("music-btn");
const bgAudio = document.getElementById("bg-audio");
// 提示：将 music.mp3 放到与此文件同级目录即可启用背景音乐
bgAudio.src = "music.mp3";
let musicOn = false;
musicBtn.addEventListener("click", () => {
  musicOn = !musicOn;
  if (musicOn) {
    bgAudio.play().catch(() => {
      musicOn = false;
      musicBtn.classList.remove("music-on");
    });
  } else {
    bgAudio.pause();
  }
  musicBtn.classList.toggle("music-on", musicOn);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    bgAudio.pause();
  } else if (musicOn) {
    bgAudio.play().catch(() => {});
  }
});

// ── Smart scroll ───────────────────────────
function isNearBottom() {
  return (
    messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <
    80
  );
}
function scrollIfNeeded() {
  if (isNearBottom()) messagesEl.scrollTop = messagesEl.scrollHeight;
}
function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── State ──────────────────────────────────
// FIX: 改名 chatHistory，避免覆盖全局 window.history
let chatHistory = [],
  displayLog = [],
  pendingImages = [];
let abortController = null;
function getSystemMsg() {
  const p = PERSONAS[currentPersona];
  return p ? [{ role: "system", content: p }] : [];
}

// ── Storage ────────────────────────────────
function saveToStorage() {
  try {
    const safeHistory = chatHistory.map((msg) => {
      if (msg.images) {
        const { images, ...rest } = msg;
        return rest;
      }
      return msg;
    });
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        persona: currentPersona,
        log: displayLog,
        history: safeHistory,
      }),
    );
  } catch (e) {
    console.warn("saveToStorage full, fallback", e);
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          persona: currentPersona,
          log: displayLog,
          history: getSystemMsg(),
        }),
      );
    } catch (e2) {
      console.warn("saveToStorage fallback failed", e2);
    }
  }
}
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    currentPersona = data.persona || "default";
    displayLog = data.log || [];
    chatHistory = data.history || getSystemMsg();
    return displayLog.length > 0;
  } catch (e) {
    console.warn("loadFromStorage failed", e);
    return false;
  }
}

// ── Load models ────────────────────────────
async function loadModels() {
  // FIX: 加载中状态提示
  modelSelect.innerHTML = "<option disabled selected>加载中...</option>";
  try {
    const res = await fetch("/api/tags", {
      headers: API_HEADERS,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = data.models || [];
    if (!models.length) {
      modelSelect.innerHTML = '<option value="">无可用模型</option>';
      return;
    }
    modelSelect.innerHTML = "";
    models.forEach((m) => {
      const o = document.createElement("option");
      o.value = m.name;
      o.textContent = m.name;
      if (m.name.includes("qwen3.5")) o.selected = true;
      modelSelect.appendChild(o);
    });
  } catch (e) {
    // FIX: 带具体错误信息的警告，方便排查
    console.warn(
      "loadModels failed:",
      e.message,
      "— 请确认 Ollama 已启动（ollama serve）",
    );
    modelSelect.innerHTML = '<option value="qwen3.5:9b">qwen3.5:9b</option>';
  }
}
loadModels();

// ── Persona UI ─────────────────────────────
function applyPersonaUI() {
  document
    .querySelectorAll(".persona-btn")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.persona === currentPersona),
    );
}
document.querySelectorAll(".persona-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.persona === currentPersona) return;
    currentPersona = btn.dataset.persona;
    localStorage.setItem("persona", currentPersona);
    applyPersonaUI();
    clearChat();
  });
});
applyPersonaUI();

// ── Welcome ────────────────────────────────
function showWelcome() {
  messagesEl.querySelectorAll(".welcome").forEach((w) => w.remove());
  const icon = currentPersona === "neko" ? "🐱" : "⬡";
  const sub =
    currentPersona === "neko"
      ? "喵~别以为我见到你会很高兴！<br>Running on RTX 4070 · 8K context"
      : "本地 AI 已就绪，开始对话吧<br>Running on RTX 4070 · 8K context";
  const w = document.createElement("div");
  w.className = "welcome";
  w.innerHTML = `<div class="welcome-icon">${icon}</div><h2>NEURAL LINK ESTABLISHED</h2><p>${sub}</p>`;
  messagesEl.appendChild(w);
}

// ── Clear ──────────────────────────────────
function clearChat() {
  chatHistory = getSystemMsg();
  displayLog = [];
  pendingImages = [];
  previewStrip.innerHTML = "";
  previewStrip.classList.remove("has-images");
  messagesEl.innerHTML = "";
  showWelcome();
  saveToStorage();
}
clearBtn.addEventListener("click", clearChat);

// ── Restore session ────────────────────────
function restoreSession() {
  messagesEl.innerHTML = "";
  if (!loadFromStorage() || !displayLog.length) {
    showWelcome();
    return;
  }
  applyPersonaUI();
  displayLog.forEach((entry, idx) => {
    if (entry.role === "user") {
      const b = addBubble("user");
      const d = document.createElement("div");
      d.textContent = entry.text;
      b.appendChild(d);
      addEditBtn(b, idx);
    } else {
      const b = addBubble("ai");
      if (entry.thinking) {
        b.appendChild(buildThinkBlock(entry.thinking, true));
        b.appendChild(makeAnswerHeader());
      }
      const md = document.createElement("div");
      md.className = "md-content";
      md.innerHTML = mdToHtml(entry.text);
      b.appendChild(md);
      appendReplyBar(b, entry.text, entry.tps || "", idx);
      renderMath(b);
    }
  });
  scrollToBottom();
}

// ── Image helpers ──────────────────────────
function readAsDataUrl(f) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = (e) => res(e.target.result);
    r.readAsDataURL(f);
  });
}

// FIX: 删除后重建所有索引，避免错位
function rebuildThumbIndexes() {
  previewStrip
    .querySelectorAll(".preview-thumb")
    .forEach((el, i) => (el.dataset.idx = i));
}
function addThumb(dataUrl, idx) {
  previewStrip.classList.add("has-images");
  const div = document.createElement("div");
  div.className = "preview-thumb";
  div.dataset.idx = idx;
  div.innerHTML = `<img src="${dataUrl}"><div class="remove-img" onclick="removeThumb(this)">✕</div>`;
  previewStrip.appendChild(div);
}
function removeThumb(btn) {
  const div = btn.parentElement;
  pendingImages.splice(parseInt(div.dataset.idx), 1);
  div.remove();
  rebuildThumbIndexes(); // FIX: 重建索引
  if (!previewStrip.children.length)
    previewStrip.classList.remove("has-images");
}
async function addImageFile(file) {
  if (!file.type.startsWith("image/")) return;
  const dataUrl = await readAsDataUrl(file);
  pendingImages.push({
    base64: dataUrl.split(",")[1],
    mimeType: file.type,
    dataUrl,
  });
  addThumb(dataUrl, pendingImages.length - 1);
}

// ── Image upload ───────────────────────────
imgBtn.addEventListener("click", () => imgFile.click());
imgFile.addEventListener("change", async () => {
  for (const file of imgFile.files) await addImageFile(file);
  imgFile.value = "";
});

// FIX: 粘贴图片支持
inputEl.addEventListener("paste", async (e) => {
  for (const item of e.clipboardData.items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      await addImageFile(item.getAsFile());
    }
  }
});

// FIX: 拖拽图片支持
inputWrapper.addEventListener("dragover", (e) => {
  e.preventDefault();
  inputWrapper.classList.add("drag-over");
});
inputWrapper.addEventListener("dragleave", (e) => {
  if (!inputWrapper.contains(e.relatedTarget))
    inputWrapper.classList.remove("drag-over");
});
inputWrapper.addEventListener("drop", async (e) => {
  e.preventDefault();
  inputWrapper.classList.remove("drag-over");
  for (const file of e.dataTransfer.files) await addImageFile(file);
});

// ── Textarea auto-resize ───────────────────
const isMobile = () => navigator.maxTouchPoints > 0 || window.innerWidth < 600;
inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 400) + "px";
});
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !isMobile()) {
    e.preventDefault();
    sendMessage();
  }
});
sendBtn.addEventListener("click", sendMessage);

// ── DOM helpers ────────────────────────────
function addBubble(role, images = []) {
  messagesEl.querySelectorAll(".welcome").forEach((w) => w.remove());
  const msg = document.createElement("div");
  msg.className = `message ${role}`;
  const av = document.createElement("div");
  av.className = "avatar";
  av.textContent =
    role === "user" ? "YOU" : currentPersona === "neko" ? "🐱" : "AI";
  if (role === "ai" && currentPersona === "neko")
    av.classList.add("neko-avatar");
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  images.forEach((img) => {
    const im = document.createElement("img");
    im.className = "upload-preview";
    im.src = img.dataUrl;
    bubble.appendChild(im);
  });
  msg.appendChild(av);
  msg.appendChild(bubble);
  messagesEl.appendChild(msg);
  scrollIfNeeded();
  return bubble;
}
function buildThinkBlock(text, collapsed = true) {
  const el = document.createElement("div");
  el.className = "thinking-block" + (collapsed ? " collapsed" : "");
  el.addEventListener("click", () => el.classList.toggle("collapsed"));
  const label = document.createElement("div");
  label.className = "thinking-label";
  label.innerHTML = '<span class="toggle-icon">▾</span> 🧠 THINKING';
  const content = document.createElement("div");
  content.className = "thinking-content";
  content.textContent = text;
  el.appendChild(label);
  el.appendChild(content);
  return el;
}
function makeAnswerHeader() {
  const h = document.createElement("div");
  h.className = "answer-header";
  h.innerHTML = "💬 回答";
  return h;
}
function addEditBtn(bubble, logIdx) {
  const btn = document.createElement("button");
  btn.className = "edit-msg-btn";
  btn.textContent = "✏️";
  btn.title = "编辑此消息";
  btn.addEventListener("click", () => editMessage(logIdx));
  bubble.appendChild(btn);
}
function appendReplyBar(bubble, plainText, tpsText, logIdx) {
  if (tpsText) {
    const badgeRow = document.createElement("div");
    badgeRow.className = "reply-bar";
    badgeRow.style.marginTop = "7px";
    const badge = document.createElement("span");
    badge.className = "tps-badge";
    badge.textContent = tpsText;
    badgeRow.appendChild(badge);
    bubble.appendChild(badgeRow);
  }
  const bar = document.createElement("div");
  bar.className = "reply-bar";
  bar.style.marginTop = "5px";

  const copyBtn = document.createElement("button");
  copyBtn.className = "copy-reply-btn";
  copyBtn.textContent = "复制";
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(plainText).then(() => {
      copyBtn.textContent = "✓";
      setTimeout(() => (copyBtn.textContent = "复制"), 1500);
    });
  });
  bar.appendChild(copyBtn);

  const shareBtn = document.createElement("button");
  shareBtn.className = "action-btn";
  shareBtn.textContent = "📸";
  shareBtn.title = "生成分享卡片";
  shareBtn.addEventListener("click", () =>
    showShareCard(plainText, tpsText, bubble),
  );
  bar.appendChild(shareBtn);

  const regenBtn = document.createElement("button");
  regenBtn.className = "action-btn";
  regenBtn.textContent = "🔄";
  regenBtn.title = "重新生成";
  regenBtn.addEventListener("click", () => regenerate());
  bar.appendChild(regenBtn);

  bubble.appendChild(bar);
}

// ── Edit message ───────────────────────────
function editMessage(logIdx) {
  const entry = displayLog[logIdx];
  if (!entry || entry.role !== "user") return;
  inputEl.value = entry.text === "[图片]" ? "" : entry.text;
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 300) + "px";
  inputEl.focus();
  const sysOffset = chatHistory[0]?.role === "system" ? 1 : 0;
  chatHistory.splice(logIdx + sysOffset);
  displayLog.splice(logIdx);
  const msgs = [...messagesEl.querySelectorAll(".message")];
  msgs.forEach((m, i) => {
    if (i >= logIdx) m.remove();
  });
  if (!displayLog.length) showWelcome();
  saveToStorage();
}

// ── Regenerate last response ───────────────
async function regenerate() {
  if (sendBtn.disabled) return;
  if (
    !displayLog.length ||
    displayLog[displayLog.length - 1].role !== "assistant"
  )
    return;
  displayLog.pop();
  chatHistory.pop();
  const aiMsgs = messagesEl.querySelectorAll(".message.ai");
  if (aiMsgs.length) aiMsgs[aiMsgs.length - 1].remove();
  saveToStorage();
  sendBtn.disabled = true;
  try {
    await callAPI(modelSelect.value);
  } finally {
    sendBtn.disabled = false;
    if (!isMobile()) inputEl.focus();
  }
}

// ── Share / Long screenshot ────────────────
function showShareCard(plainText, tpsText, bubble) {
  const overlay = document.createElement("div");
  overlay.className = "share-overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const card = document.createElement("div");
  card.className = "share-card";
  const label = currentPersona === "neko" ? "🐱" : "AI";
  const preview =
    plainText.length > 300 ? plainText.slice(0, 300) + "…" : plainText;
  // FIX: tpsText 也做 HTML 转义
  const escHtml = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  card.innerHTML = `
<div class="share-card-header">
<div class="share-card-av">${label}</div>
<span class="share-card-model">${escHtml(modelSelect.value)}</span>
</div>
<div class="share-card-body">${escHtml(preview)}</div>
<div class="share-card-footer">
<span class="share-card-logo">// LOCAL AI //</span>
<span class="share-card-tps">${escHtml(tpsText || "")}</span>
</div>`;

  const btnRow = document.createElement("div");
  btnRow.className = "share-btn-row";

  const dlBtn = document.createElement("button");
  dlBtn.className = "share-action-btn share-dl-btn";
  dlBtn.textContent = "📥 长截图";
  dlBtn.addEventListener("click", async () => {
    dlBtn.textContent = "⏳ 渲染中...";
    dlBtn.disabled = true;
    try {
      const wrap = document.createElement("div");
      const themeDark = document.documentElement.dataset.theme !== "light";
      const shotBg = themeDark ? "#111118" : "#ffffff";
      const shotText = themeDark ? "#e2e0f0" : "#1a1a2e";
      const shotMuted = themeDark ? "#4a4860" : "#5a6a9a";
      const shotBorder = themeDark ? "#1e1e2e" : "#cdd6f0";
      wrap.style.cssText = `position:fixed;left:-9999px;top:0;width:680px;background:${shotBg};padding:20px;border-radius:12px;font-family:'Noto Sans SC',sans-serif`;
      const hdrStrip = document.createElement("div");
      hdrStrip.style.cssText = `font-family:'JetBrains Mono',monospace;font-size:10px;color:${shotMuted};margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid ${shotBorder};display:flex;justify-content:space-between`;
      hdrStrip.innerHTML = `<span>${label} · ${escHtml(modelSelect.value)}</span><span>// LOCAL AI //</span>`;
      wrap.appendChild(hdrStrip);
      const bubbleClone = bubble.cloneNode(true);
      bubbleClone
        .querySelectorAll(".reply-bar,.edit-msg-btn")
        .forEach((el) => el.remove());
      bubbleClone.style.cssText = `max-width:100%;padding:0;background:transparent;border:none;color:${shotText};font-size:14px;line-height:1.75;word-break:break-word`;
      if (!themeDark) {
        bubbleClone
          .querySelectorAll("pre")
          .forEach((el) => (el.style.background = "#eef1f9"));
        bubbleClone
          .querySelectorAll("code.hljs")
          .forEach((el) => (el.style.color = "#383a42"));
        bubbleClone.querySelectorAll(":not(pre)>code").forEach((el) => {
          el.style.background = "rgba(67,97,238,0.08)";
          el.style.color = "#3a56d4";
        });
      }
      wrap.appendChild(bubbleClone);
      const foot = document.createElement("div");
      foot.style.cssText = `font-family:'JetBrains Mono',monospace;font-size:9px;color:${shotMuted};margin-top:14px;padding-top:10px;border-top:1px solid ${shotBorder};text-align:right`;
      foot.textContent = tpsText || "";
      wrap.appendChild(foot);
      document.body.appendChild(wrap);
      const canvas = await html2canvas(wrap, {
        backgroundColor: shotBg,
        scale: 2,
        useCORS: true,
        logging: false,
        windowWidth: 720,
        scrollX: 0,
        scrollY: 0,
      });
      document.body.removeChild(wrap);
      const a = document.createElement("a");
      a.download = `ai-shot-${Date.now()}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch (err) {
      console.error("截图失败", err);
      alert("截图失败：" + err.message);
    }
    dlBtn.textContent = "📥 长截图";
    dlBtn.disabled = false;
  });

  const closeBtn = document.createElement("button");
  closeBtn.className = "share-action-btn share-close-btn";
  closeBtn.textContent = "✕ 关闭";
  closeBtn.addEventListener("click", () => overlay.remove());

  btnRow.appendChild(dlBtn);
  btnRow.appendChild(closeBtn);
  overlay.appendChild(card);
  overlay.appendChild(btnRow);
  document.body.appendChild(overlay);
}

// ── Send message ───────────────────────────
async function sendMessage() {
  const text = inputEl.value.trim();
  if ((!text && !pendingImages.length) || sendBtn.disabled) return;
  const model = modelSelect.value,
    images = [...pendingImages];
  inputEl.value = "";
  inputEl.style.height = "auto";
  sendBtn.disabled = true;
  pendingImages = [];
  previewStrip.innerHTML = "";
  previewStrip.classList.remove("has-images");

  const userBubble = addBubble("user", images);
  if (text) {
    const d = document.createElement("div");
    d.textContent = text;
    userBubble.appendChild(d);
  }
  const userLogIdx = displayLog.length;
  addEditBtn(userBubble, userLogIdx);
  scrollToBottom();

  const userMsg = { role: "user", content: text || "" };
  if (images.length) userMsg.images = images.map((i) => i.base64);
  chatHistory.push(userMsg);
  displayLog.push({ role: "user", text: text || "[图片]" });
  saveToStorage();

  try {
    await callAPI(model);
  } finally {
    sendBtn.disabled = false;
    if (!isMobile()) inputEl.focus();
  }
}

// ── Core streaming API call ────────────────
async function callAPI(model) {
  const aiBubble = addBubble("ai");
  const cursor = document.createElement("span");
  cursor.className = "cursor";
  aiBubble.appendChild(cursor);

  const liveBar = document.createElement("div");
  liveBar.className = "reply-bar";
  const stopBtn = document.createElement("button");
  stopBtn.className = "stop-btn";
  stopBtn.textContent = "⏹ 停止";
  stopBtn.addEventListener("click", () => {
    if (abortController) abortController.abort();
  });
  liveBar.appendChild(stopBtn);
  aiBubble.appendChild(liveBar);

  let thinkBuf = "",
    mainBuf = "";
  let thinkEl = null,
    thinkTextEl = null,
    answerHeaderEl = null;
  let rawBuf = "",
    inThink = false,
    netBuf = "";
  let contentTokenCount = 0,
    thinkCharCount = 0;
  const startTime = Date.now();
  let stopped = false;

  abortController = new AbortController();

  function createThinkBlockLive() {
    thinkEl = document.createElement("div");
    thinkEl.className = "thinking-block";
    thinkEl.addEventListener("click", () =>
      thinkEl.classList.toggle("collapsed"),
    );
    const label = document.createElement("div");
    label.className = "thinking-label";
    label.innerHTML = '<span class="toggle-icon">▾</span> 🧠 THINKING';
    thinkTextEl = document.createElement("div");
    thinkTextEl.className = "thinking-content";
    thinkEl.appendChild(label);
    thinkEl.appendChild(thinkTextEl);
    aiBubble.insertBefore(thinkEl, liveBar);
  }
  function finishThink() {
    if (thinkEl && !answerHeaderEl) {
      thinkEl.querySelector(".thinking-label").innerHTML =
        '<span class="toggle-icon">▾</span> 🧠 THINKING';
      thinkEl.classList.add("collapsed");
      answerHeaderEl = makeAnswerHeader();
      aiBubble.insertBefore(answerHeaderEl, liveBar);
    }
  }
  function renderMain() {
    for (const n of [...aiBubble.childNodes]) {
      if (n.classList?.contains("md-content")) n.remove();
    }
    if (!mainBuf) return;
    const d = document.createElement("div");
    d.className = "md-content";
    d.innerHTML = mdToHtml(mainBuf);
    aiBubble.insertBefore(d, liveBar);
  }
  function processRaw() {
    while (true) {
      if (!inThink) {
        const si = rawBuf.indexOf("<think>");
        if (si === -1) {
          const safe =
            rawBuf.length > 7 ? rawBuf.slice(0, rawBuf.length - 7) : "";
          mainBuf += safe;
          rawBuf = rawBuf.slice(safe.length);
          break;
        }
        mainBuf += rawBuf.slice(0, si);
        rawBuf = rawBuf.slice(si + 7);
        inThink = true;
        if (!thinkEl) createThinkBlockLive();
      } else {
        const ei = rawBuf.indexOf("</think>");
        if (ei === -1) {
          const safe =
            rawBuf.length > 8 ? rawBuf.slice(0, rawBuf.length - 8) : "";
          thinkBuf += safe;
          rawBuf = rawBuf.slice(safe.length);
          if (thinkTextEl) thinkTextEl.textContent = thinkBuf;
          break;
        }
        thinkBuf += rawBuf.slice(0, ei);
        rawBuf = rawBuf.slice(ei + 8);
        inThink = false;
        finishThink();
        if (thinkTextEl) thinkTextEl.textContent = thinkBuf;
      }
    }
    renderMain();
    scrollIfNeeded();
  }

  function finalize(evalCount, evalDuration) {
    if (rawBuf) {
      if (inThink) {
        thinkBuf += rawBuf;
        if (thinkTextEl) thinkTextEl.textContent = thinkBuf;
      } else {
        mainBuf += rawBuf;
      }
      rawBuf = "";
    }
    renderMain();
    finishThink();
    cursor.remove();
    liveBar.remove();
    const elapsed =
      evalDuration > 0
        ? (evalDuration / 1e9).toFixed(1)
        : ((Date.now() - startTime) / 1000).toFixed(1);
    const tps =
      evalDuration > 0 ? (evalCount / (evalDuration / 1e9)).toFixed(1) : "?";
    const thinkTokenEst = Math.round(thinkCharCount / 3.5);
    const totalTokens = evalCount + thinkTokenEst;
    let tpsText = stopped
      ? thinkTokenEst > 0
        ? `~${totalTokens} tokens · ${tps} t/s · ${elapsed}s ⏹`
        : `${evalCount || contentTokenCount} tokens · ${tps} t/s · ${elapsed}s ⏹`
      : thinkTokenEst > 0
        ? `~${totalTokens} tokens (含思考) · ${tps} t/s · ${elapsed}s`
        : `${evalCount} tokens · ${tps} t/s · ${elapsed}s`;
    const aiLogIdx = displayLog.length;
    appendReplyBar(aiBubble, mainBuf, tpsText, aiLogIdx);
    chatHistory.push({ role: "assistant", content: mainBuf });
    displayLog.push({
      role: "assistant",
      text: mainBuf,
      thinking: thinkBuf || null,
      tps: tpsText,
    });
    saveToStorage();
    renderMath(aiBubble);
    scrollIfNeeded();
  }

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: API_HEADERS,
      body: JSON.stringify({
        model,
        messages: chatHistory,
        stream: true,
      }),
      signal: abortController.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let lastEvalCount = 0,
      lastEvalDuration = 0;
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = (netBuf + decoder.decode(value, { stream: true })).split(
        "\n",
      );
      netBuf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          const thinkToken = data?.message?.thinking || "";
          if (thinkToken) {
            if (!thinkEl) createThinkBlockLive();
            thinkBuf += thinkToken;
            thinkCharCount += thinkToken.length;
            if (thinkTextEl) thinkTextEl.textContent = thinkBuf;
            scrollIfNeeded();
          }
          const token = data?.message?.content || "";
          if (token) {
            contentTokenCount++;
            if (thinkBuf && !inThink) {
              if (!answerHeaderEl) finishThink();
              mainBuf += token;
              renderMain();
            } else {
              rawBuf += token;
              processRaw();
            }
            scrollIfNeeded();
          }
          if (data.eval_count) lastEvalCount = data.eval_count;
          if (data.eval_duration) lastEvalDuration = data.eval_duration;
          if (data.done) {
            finalize(lastEvalCount, lastEvalDuration);
            break outer;
          }
        } catch (e) {
          console.warn("JSON parse error in stream", e);
        }
      }
    }
  } catch (e) {
    cursor.remove();
    liveBar.remove();
    if (e.name === "AbortError") {
      stopped = true;
      finalize(contentTokenCount, 0);
    } else {
      console.error("callAPI error", e);
      aiBubble.textContent =
        "⚠ 连接失败，请检查 Ollama 是否在运行（ollama serve）";
    }
  }
  abortController = null;
  cursor.remove();
}

// ── Init ───────────────────────────────────
restoreSession();
