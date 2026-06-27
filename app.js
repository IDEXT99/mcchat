// ══════════════════════════════════════════════════════════════
//  NOVACHAT — app.js
//  Paste your Firebase Realtime Database config here:
// ══════════════════════════════════════════════════════════════
const firebaseConfig = {
  apiKey: "AIzaSyBWa4PjAovEiTi38pHCuTGE1_L8uBlpmiQ",
  authDomain: "chatwith-dba45.firebaseapp.com",
  databaseURL: "https://chatwith-dba45-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "chatwith-dba45",
  storageBucket: "chatwith-dba45.firebasestorage.app",
  messagingSenderId: "313286542860",
  appId: "1:313286542860:web:0f70a1af9183f5bfa39029",
  measurementId: "G-X676WLGJ5S"
};
// ══════════════════════════════════════════════════════════════
//  Firebase SDK
// ══════════════════════════════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, push, set, get, update, remove,
  onValue, off, onDisconnect, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const fbApp = initializeApp(firebaseConfig);
const db    = getDatabase(fbApp);

// ══════════════════════════════════════════════════════════════
//  Constants
// ══════════════════════════════════════════════════════════════
const GATE_PASS     = "3232";
const RECOVERY_CODE = "spiderman";
const TTL_MS        = 172_800_000;     // 48 hours — client-side message purge
const CLEANUP_MS    = 43_200_000;      // 12 hours — media cleanup threshold
const REACTIONS     = ["❤️","😂","😮","😢","👍"];
const EMOJI_GRID     = [
  "😀","😂","😍","🥰","😎","🤔","😭","😡","🥳","😴",
  "👍","👎","👏","🙏","💪","🔥","✨","🎉","💯","❤️",
  "😢","😮","😅","🙄","😇","🤝","👀","💀","🤯","😤",
  "🍕","☕","🎮","⚽","🚀","🌙","☀️","🌧️","🎵","📸",
];

// ── The one name that unlocks the maintenance panel.
//    This is a convenience flag for a small trusted group, not a real
//    security boundary — anyone reading this file can see it. It only
//    ever touches shared app data (the group chat, stale media, or a
//    full reset of the demo database). It can never read, list, or
//    touch anyone's private DMs — that capability doesn't exist anywhere
//    in this app, for any account.
const MAINTAINER_NAME = "sachu";
const MAINTAINER_PASS = "riya";

// ══════════════════════════════════════════════════════════════
//  App State
// ══════════════════════════════════════════════════════════════
let me              = null;   // { id, name, avatar, isMaintainer }
let currentRoomPath = null;   // Firebase path string
let currentRoomId   = null;   // "group" | "userA_userB"
let allUsers        = {};     // { userId: { name, avatar } }
let activeListeners = [];     // [{ r, fn }] for cleanup
let typingTimer     = null;
let mediaRec        = null;
let recInterval     = null;
let recSecs         = 0;
let recChunks       = [];
let camStream       = null;

// ══════════════════════════════════════════════════════════════
//  DOM helpers
// ══════════════════════════════════════════════════════════════
const $  = id => document.getElementById(id);
const fc = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  });
  children.forEach(c => c && el.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return el;
};

// ══════════════════════════════════════════════════════════════
//  Utility
// ══════════════════════════════════════════════════════════════
function genAvatar(name = "?", color = "#00F2FE") {
  const initials = (name.slice(0,2) || "??").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <rect width="40" height="40" rx="20" fill="${color}22"/>
    <text x="20" y="26" text-anchor="middle" font-family="Inter,sans-serif" font-size="14" font-weight="700" fill="${color}">${initials}</text>
  </svg>`;
  return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
}

const COLORS = ["#00F2FE","#7c3aed","#0891b2","#059669","#dc2626","#d97706","#db2777"];
function pickColor(name) { return COLORS[name.charCodeAt(0) % COLORS.length]; }

function fileToB64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function roomIdFor(a, b) { return [a, b].sort().join("_"); }

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function scrollBottom() {
  const area = $("msgArea");
  area.scrollTop = area.scrollHeight;
}

function showToast(msg, err = false) {
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:${err ? "#450a0a" : "#0f172a"};color:${err ? "#fca5a5" : "#00F2FE"};
    border:1px solid ${err ? "#7f1d1d" : "#252840"};border-radius:12px;
    padding:10px 20px;font-size:13px;z-index:9999;pointer-events:none;
    animation:fadeIn .25s ease;`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

function clearActiveListeners() {
  activeListeners.forEach(({ r, fn }) => { try { off(r, "value", fn); } catch(_){} });
  activeListeners = [];
}

function avatarImg(src, size = "32px", extraStyle = "") {
  const wrap = document.createElement("div");
  wrap.style.cssText = `width:${size};height:${size};border-radius:50%;overflow:hidden;flex-shrink:0;${extraStyle}`;
  const img = document.createElement("img");
  img.src = src;
  img.style.cssText = "width:100%;height:100%;object-fit:cover;";
  wrap.appendChild(img);
  return wrap;
}

function escapeHtml(str = "") {
  return str.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

// Generic confirm modal — returns a Promise<boolean>
function confirmDialog(title, body) {
  return new Promise(resolve => {
    $("confirmTitle").textContent = title;
    $("confirmBody").textContent  = body;
    $("confirmModal").classList.remove("hidden");
    $("confirmModal").classList.add("fc");

    const cleanup = () => {
      $("confirmModal").classList.add("hidden");
      $("confirmModal").classList.remove("fc");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
    };
    const okBtn = $("confirmOk"), cancelBtn = $("confirmCancel");
    const onOk     = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}

// ══════════════════════════════════════════════════════════════
//  LAYER 1 — GLOBAL GATE
// ══════════════════════════════════════════════════════════════
const gateOverlay = $("gateOverlay");
const gateInput   = $("gateInput");
const gateError   = $("gateError");
const gateSubmit  = $("gateSubmit");

function dismissGate() {
  gateOverlay.classList.add("overlay-out");
  gateOverlay.addEventListener("animationend", () => {
    gateOverlay.style.display = "none";
    afterGate();
  }, { once: true });
}

gateSubmit.addEventListener("click", () => {
  if (gateInput.value.trim() === GATE_PASS) {
    sessionStorage.setItem("nc_gate", "1");
    dismissGate();
  } else {
    gateError.style.opacity = "1";
    gateInput.classList.add("animate-shake");
    gateInput.style.borderColor = "#ef4444";
    setTimeout(() => {
      gateInput.classList.remove("animate-shake");
      gateInput.style.borderColor = "";
    }, 450);
  }
});

gateInput.addEventListener("keydown", e => {
  if (e.key === "Enter") gateSubmit.click();
  gateError.style.opacity = "0";
  gateInput.style.borderColor = "";
});

if (sessionStorage.getItem("nc_gate") === "1") {
  gateOverlay.style.display = "none";
  afterGate();
} else {
  // gate stays visible
}

// Decide whether to show the auth hub or resume an existing session.
function afterGate() {
  const savedId = localStorage.getItem("nc_session");
  if (savedId) {
    resumeSession(savedId);
  } else {
    $("authHub").classList.remove("hidden");
  }
}

async function resumeSession(userId) {
  try {
    const snap = await get(ref(db, `users/${userId}`));
    if (!snap.exists()) { localStorage.removeItem("nc_session"); $("authHub").classList.remove("hidden"); return; }
    const u = snap.val();
    enterApp(userId, u);
  } catch (_) {
    $("authHub").classList.remove("hidden");
  }
}

// ══════════════════════════════════════════════════════════════
//  LAYER 2 — AUTH HUB (tabs)
// ══════════════════════════════════════════════════════════════
function switchTab(tab) {
  const isLogin = tab === "login";
  $("tabLogin").className  = "flex-1 py-3.5 text-sm font-semibold transition-colors " + (isLogin  ? "tab-active" : "text-slate-500");
  $("tabCreate").className = "flex-1 py-3.5 text-sm font-semibold transition-colors " + (!isLogin ? "tab-active" : "text-slate-500");
  $("tabLogin").style.cssText  = `background:transparent;border:none;border-bottom:${isLogin  ? "2px solid #00F2FE":"2px solid transparent"};cursor:pointer;`;
  $("tabCreate").style.cssText = `background:transparent;border:none;border-bottom:${!isLogin ? "2px solid #00F2FE":"2px solid transparent"};cursor:pointer;`;
  $("panelLogin").className  = isLogin  ? "p-7 flex flex-col gap-4" : "hidden";
  $("panelCreate").className = !isLogin ? "p-7 flex flex-col gap-4" : "hidden";
}
window.switchTab = switchTab;

// ── Register ──
let regAvatarB64 = null;
$("regPhoto").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  regAvatarB64 = await fileToB64(file);
  $("regAvatarPreview").innerHTML = `<img src="${regAvatarB64}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>`;
});

$("registerBtn").addEventListener("click", async () => {
  const name = $("regName").value.trim();
  const pass = $("regPass").value.trim();
  const errEl = $("regError");
  errEl.textContent = "";

  if (!name) { errEl.textContent = "Name is required."; return; }
  if (name.length < 2) { errEl.textContent = "Name must be at least 2 characters."; return; }
  if (!pass) { errEl.textContent = "Password is required."; return; }

  const safeId = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  if (!safeId) { errEl.textContent = "Name contains invalid characters."; return; }

  try {
    const snap = await get(ref(db, `users/${safeId}`));
    if (snap.exists()) { errEl.textContent = "That name is already taken."; return; }

    const avatar = regAvatarB64 || genAvatar(name, pickColor(name));
    const userData = { name, pass, avatar, createdAt: Date.now() };
    await set(ref(db, `users/${safeId}`), userData);

    enterApp(safeId, userData);
  } catch (e) {
    errEl.textContent = "Something went wrong. Please try again.";
  }
});

// ── Login ──
$("loginBtn").addEventListener("click", async () => {
  const name = $("loginName").value.trim();
  const pass = $("loginPass").value.trim();
  const errEl = $("loginError");
  errEl.textContent = "";

  if (!name || !pass) { errEl.textContent = "Enter your name and password."; return; }

  const safeId = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  try {
    const snap = await get(ref(db, `users/${safeId}`));
    if (!snap.exists()) { errEl.textContent = "No account with that name."; return; }
    const u = snap.val();
    if (u.pass !== pass) { errEl.textContent = "Incorrect password."; return; }
    enterApp(safeId, u);
  } catch (e) {
    errEl.textContent = "Something went wrong. Please try again.";
  }
});

[$("loginPass"), $("loginName")].forEach(el =>
  el.addEventListener("keydown", e => { if (e.key === "Enter") $("loginBtn").click(); })
);
[$("regName"), $("regPass")].forEach(el =>
  el.addEventListener("keydown", e => { if (e.key === "Enter") $("registerBtn").click(); })
);

// ── Forgot password ──
$("forgotLink").addEventListener("click", () => {
  $("forgotStep1").classList.remove("hidden");
  $("forgotStep1").classList.add("flex");
  $("forgotStep2").classList.add("hidden");
  $("forgotStep2").classList.remove("flex");
  $("forgotUsername").value = "";
  $("forgotCode").value = "";
  $("forgotError").textContent = "";
  $("forgotModal").classList.remove("hidden");
  $("forgotModal").classList.add("fc");
});
$("closeForgot").addEventListener("click", () => {
  $("forgotModal").classList.add("hidden");
  $("forgotModal").classList.remove("fc");
});

let forgotUserId = null;
$("forgotVerifyBtn").addEventListener("click", async () => {
  const name = $("forgotUsername").value.trim();
  const code = $("forgotCode").value.trim();
  const errEl = $("forgotError");
  errEl.textContent = "";

  if (!name || !code) { errEl.textContent = "Fill in both fields."; return; }
  if (code !== RECOVERY_CODE) { errEl.textContent = "Invalid recovery code."; return; }

  const safeId = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  try {
    const snap = await get(ref(db, `users/${safeId}`));
    if (!snap.exists()) { errEl.textContent = "No account with that name."; return; }
    forgotUserId = safeId;
    $("forgotUser2").textContent = snap.val().name;
    $("forgotStep1").classList.add("hidden");
    $("forgotStep1").classList.remove("flex");
    $("forgotStep2").classList.remove("hidden");
    $("forgotStep2").classList.add("flex");
  } catch (_) { errEl.textContent = "Something went wrong."; }
});

$("forgotSaveBtn").addEventListener("click", async () => {
  const newPass = $("forgotNewPass").value.trim();
  const errEl = $("forgotError2");
  if (!newPass) { errEl.textContent = "Enter a new password."; return; }
  try {
    await update(ref(db, `users/${forgotUserId}`), { pass: newPass });
    showToast("Password updated. You can log in now.");
    $("forgotModal").classList.add("hidden");
    $("forgotModal").classList.remove("fc");
  } catch (_) { errEl.textContent = "Something went wrong."; }
});
// ══════════════════════════════════════════════════════════════
//  ENTER APP
// ══════════════════════════════════════════════════════════════
function enterApp(userId, userData) {
  const isMaintainer = userId === MAINTAINER_NAME && userData.pass === MAINTAINER_PASS;
  me = { id: userId, name: userData.name, avatar: userData.avatar || genAvatar(userData.name), isMaintainer };

  localStorage.setItem("nc_session", userId);

  $("authHub").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  $("appShell").style.display = "block";

  $("myName").textContent = me.name;
  $("myAvatar").src = me.avatar;

  if (me.isMaintainer) {
    $("adminEntry").classList.remove("hidden");
  }

  // presence
  const presenceRef = ref(db, `presence/${me.id}`);
  set(presenceRef, { online: true, name: me.name });
  onDisconnect(presenceRef).set({ online: false, name: me.name });
  window.addEventListener("beforeunload", () => { clearTypingFlag(); });

  listenUsers();
  openRoom("group", "Main Group Chat", null);
  runPurgeSweep();
  setInterval(runPurgeSweep, 60_000);
}

$("logoutBtn").addEventListener("click", () => {
  clearTypingFlag();
  set(ref(db, `presence/${me.id}`), { online: false, name: me.name }).catch(()=>{});
  clearActiveListeners();
  localStorage.removeItem("nc_session");
  me = null;
  currentRoomId = null;
  currentRoomPath = null;
  $("appShell").classList.add("hidden");
  $("appShell").style.display = "none";
  $("adminEntry").classList.add("hidden");
  $("authHub").classList.remove("hidden");
  $("loginName").value = "";
  $("loginPass").value = "";
});

// ══════════════════════════════════════════════════════════════
//  SIDEBAR — DRAWER (mobile)
// ══════════════════════════════════════════════════════════════
function openDrawer() {
  $("sidebar").classList.add("drawer-open");
  $("sidebarOverlay").style.display = "block";
}
function closeDrawer() {
  $("sidebar").classList.remove("drawer-open");
  $("sidebarOverlay").style.display = "none";
}
$("hamburgerBtn").addEventListener("click", openDrawer);
$("closeSidebarBtn").addEventListener("click", closeDrawer);
$("sidebarOverlay").addEventListener("click", closeDrawer);

// ══════════════════════════════════════════════════════════════
//  USERS LIST → DM SIDEBAR
// ══════════════════════════════════════════════════════════════
function listenUsers() {
  const r = ref(db, "users");
  const fn = snap => {
    allUsers = snap.val() || {};
    renderDmList();
  };
  onValue(r, fn);
  activeListeners.push({ r, fn });
}

function renderDmList() {
  const list = $("dmList");
  list.innerHTML = "";
  Object.entries(allUsers)
    .filter(([id]) => id !== me.id)
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .forEach(([id, u]) => {
      const row = fc("div", {
        class: "sidebar-item flex items-center gap-3 px-5 py-2.5",
        id: `dmrow_${id}`,
        onclick: () => { openDm(id, u); closeDrawer(); }
      },
        avatarImg(u.avatar || genAvatar(u.name), "30px"),
        fc("span", { class: "text-sm flex-1 truncate" }, u.name)
      );
      list.appendChild(row);
    });
}

function highlightActiveNav(activeEl) {
  document.querySelectorAll(".sidebar-item, #groupChannelBtn").forEach(el => el.classList.remove("nav-active"));
  activeEl.classList.add("nav-active");
}

$("groupChannelBtn").addEventListener("click", () => {
  openRoom("group", "Main Group Chat", null);
  highlightActiveNav($("groupChannelBtn"));
  closeDrawer();
});

function openDm(userId, userData) {
  const roomId = roomIdFor(me.id, userId);
  openRoom(roomId, userData.name, userData);
  const row = $(`dmrow_${userId}`);
  if (row) highlightActiveNav(row);
}

// ══════════════════════════════════════════════════════════════
//  ROOM SWITCHING
// ══════════════════════════════════════════════════════════════
function openRoom(roomId, title, otherUser) {
  clearTypingFlag();
  clearActiveListeners();
  // re-attach the users listener since clearActiveListeners wiped it
  listenUsers();

  currentRoomId   = roomId;
  currentRoomPath = roomId === "group" ? "chats/group" : `chats/direct/${roomId}`;

  $("headerTitle").textContent = title;
  if (roomId === "group") {
    $("headerSubtitle").textContent = "Everyone can see this channel";
    $("headerAvatar").src = genAvatar("GC", "#00F2FE");
  } else {
    $("headerSubtitle").textContent = "Direct message";
    $("headerAvatar").src = (otherUser && otherUser.avatar) || genAvatar(title);
  }

  $("msgArea").innerHTML = "";
  listenMessages();
  listenTyping();
}

// ══════════════════════════════════════════════════════════════
//  MESSAGES — listen & render
// ══════════════════════════════════════════════════════════════
function listenMessages() {
  const r = ref(db, currentRoomPath);
  const fn = snap => {
    const data = snap.val() || {};
    const msgs = Object.entries(data)
      .map(([id, m]) => ({ id, ...m }))
      .sort((a, b) => (a.ts || 0) - (b.ts || 0));
    renderMessages(msgs);
    updateSeenReceipts(msgs);
  };
  onValue(r, fn);
  activeListeners.push({ r, fn });
}

function renderMessages(msgs) {
  const area = $("msgArea");
  const wasNearBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 120;
  area.innerHTML = "";

  if (msgs.length === 0) {
    area.appendChild(fc("div", { class: "fc flex-col gap-2 flex-1", style: "color:#334155;" },
      fc("p", { class: "text-sm" }, "No messages yet — say hi 👋")
    ));
    return;
  }

  msgs.forEach(msg => area.appendChild(renderMessageRow(msg)));
  if (wasNearBottom) scrollBottom();
}

function renderMessageRow(msg) {
  const mine = msg.senderId === me.id;
  const sender = allUsers[msg.senderId] || { name: msg.senderName || "Unknown", avatar: null };

  const row = fc("div", { class: `msg-row flex gap-2.5 ${mine ? "flex-row-reverse" : ""}` });

  if (!mine) row.appendChild(avatarImg(sender.avatar || genAvatar(sender.name), "30px", "margin-top:2px;"));

  const col = fc("div", { class: `flex flex-col gap-1 max-w-[78%] ${mine ? "items-end" : "items-start"}` });

  if (!mine && currentRoomId === "group") {
    col.appendChild(fc("span", { class: "text-xs px-1", style: "color:#475569;" }, sender.name));
  }

  // bubble
  const bubble = fc("div", {
    class: `relative px-3.5 py-2.5 rounded-2xl ${mine ? "bubble-out" : "bubble-in"}`,
    style: "word-break:break-word;"
  });

  if (msg.editing && mine) {
    const input = fc("input", { class: "edit-field", value: msg.text || "" });
    const saveRow = fc("div", { class: "flex gap-2 mt-2" },
      fc("button", { class: "btn-neon text-xs px-3 py-1 rounded-lg", onclick: () => saveEdit(msg.id, input.value) }, "Save"),
      fc("button", { class: "btn-ghost text-xs px-3 py-1 rounded-lg", onclick: () => cancelEdit(msg.id) }, "Cancel")
    );
    bubble.appendChild(input);
    bubble.appendChild(saveRow);
  } else {
    bubble.appendChild(renderMessageContent(msg));
  }

  col.appendChild(bubble);

  // meta row: time, edited tag, ticks
  const meta = fc("div", { class: "flex items-center gap-1.5 px-1" },
    fc("span", { class: "text-xs", style: "color:#475569;" }, fmtTime(msg.ts)),
    msg.edited ? fc("span", { class: "text-xs", style: "color:#475569;" }, "· edited") : null,
  );
  if (mine && currentRoomId !== "group") {
    meta.appendChild(fc("span", { class: msg.seen ? "tick-double" : "tick-single" }));
  }
  col.appendChild(meta);

  // reactions display
  if (msg.reactions && Object.keys(msg.reactions).length) {
    const reactRow = fc("div", { class: "flex gap-1 px-1 flex-wrap" });
    const counts = {};
    Object.values(msg.reactions).forEach(e => { counts[e] = (counts[e] || 0) + 1; });
    Object.entries(counts).forEach(([emoji, count]) => {
      reactRow.appendChild(fc("span", { class: "react-badge", onclick: () => addReaction(msg.id, emoji) }, `${emoji} ${count > 1 ? count : ""}`));
    });
    col.appendChild(reactRow);
  }

  row.appendChild(col);

  // hover actions: quick reactions + edit/delete
  const actionsWrap = fc("div", { class: `flex flex-col gap-1 ${mine ? "items-end" : "items-start"} justify-center` });

  const emojiBar = fc("div", { class: "emojis flex gap-1 px-1" });
  REACTIONS.forEach(e => {
    emojiBar.appendChild(fc("button", {
      class: "text-sm transition-transform hover:scale-125",
      style: "background:none;border:none;cursor:pointer;",
      onclick: () => addReaction(msg.id, e)
    }, e));
  });
  actionsWrap.appendChild(emojiBar);

  if (mine && !msg.editing) {
    const msgActions = fc("div", { class: "msg-actions flex gap-2 px-1" });
    if (msg.type === "text" || !msg.type) {
      msgActions.appendChild(fc("button", {
        class: "text-xs", style: "background:none;border:none;cursor:pointer;color:#64748b;",
        onclick: () => startEdit(msg)
      }, "Edit"));
    }
    msgActions.appendChild(fc("button", {
      class: "text-xs", style: "background:none;border:none;cursor:pointer;color:#f87171;",
      onclick: () => deleteMsg(msg.id)
    }, "Delete"));
    actionsWrap.appendChild(msgActions);
  }

  row.appendChild(actionsWrap);

  return row;
}

function renderMessageContent(msg) {
  if (msg.type === "image") {
    const img = fc("img", { style: "max-width:220px;border-radius:12px;display:block;cursor:pointer;", src: msg.media });
    img.addEventListener("click", () => window.open(msg.media, "_blank"));
    return img;
  }
  if (msg.type === "audio") {
    const audio = fc("audio", { controls: "true", src: msg.media });
    return audio;
  }
  // text
  return fc("span", { class: "text-sm whitespace-pre-wrap" }, msg.text || "");
}
// ══════════════════════════════════════════════════════════════
//  SEND MESSAGE
// ══════════════════════════════════════════════════════════════
async function sendMessage({ type = "text", text = "", media = null } = {}) {
  if (!me || !currentRoomPath) return;
  if (type === "text" && !text.trim()) return;

  const payload = {
    senderId: me.id,
    senderName: me.name,
    type,
    text: type === "text" ? text.trim() : "",
    ts: Date.now(),
    seen: false,
  };
  if (media) payload.media = media;

  try {
    await push(ref(db, currentRoomPath), payload);
    setTyping(false);
    scrollBottom();
  } catch (e) {
    showToast("Failed to send message.", true);
  }
}

$("sendBtn").addEventListener("click", () => {
  const input = $("msgInput");
  const text = input.value;
  if (!text.trim()) return;
  sendMessage({ type: "text", text });
  input.value = "";
  input.style.height = "auto";
});

$("msgInput").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("sendBtn").click();
  }
});
$("msgInput").addEventListener("input", () => {
  const el = $("msgInput");
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 110) + "px";
});

// ══════════════════════════════════════════════════════════════
//  EMOJI PICKER
// ══════════════════════════════════════════════════════════════
const emojiPicker = $("emojiPicker");
EMOJI_GRID.forEach(e => {
  emojiPicker.appendChild(fc("button", {
    style: "background:none;border:none;cursor:pointer;font-size:18px;padding:4px;border-radius:6px;transition:background .1s;",
    onclick: () => {
      const input = $("msgInput");
      input.value += e;
      input.focus();
    }
  }, e));
});
$("emojiBtn").addEventListener("click", e => {
  e.stopPropagation();
  const open = !emojiPicker.classList.contains("hidden");
  emojiPicker.classList.toggle("hidden", open);
});
document.addEventListener("click", e => {
  if (!emojiPicker.contains(e.target) && e.target !== $("emojiBtn")) emojiPicker.classList.add("hidden");
});

// ══════════════════════════════════════════════════════════════
//  EDIT / DELETE / REACTIONS
// ══════════════════════════════════════════════════════════════
function startEdit(msg) {
  update(ref(db, `${currentRoomPath}/${msg.id}`), { editing: true }).catch(() => {});
}
async function saveEdit(msgId, text) {
  if (!text.trim()) return;
  await update(ref(db, `${currentRoomPath}/${msgId}`), { text: text.trim(), edited: true, editing: false });
}
async function cancelEdit(msgId) {
  await update(ref(db, `${currentRoomPath}/${msgId}`), { editing: false });
}
async function deleteMsg(msgId) {
  await remove(ref(db, `${currentRoomPath}/${msgId}`));
}
async function addReaction(msgId, emoji) {
  await set(ref(db, `${currentRoomPath}/${msgId}/reactions/${me.id}`), emoji);
}

// ══════════════════════════════════════════════════════════════
//  SEEN RECEIPTS
// ══════════════════════════════════════════════════════════════
function updateSeenReceipts(msgs) {
  if (!currentRoomId || currentRoomId === "group") return;
  msgs.forEach(msg => {
    if (msg.senderId !== me.id && !msg.seen) {
      update(ref(db, `${currentRoomPath}/${msg.id}`), { seen: true }).catch(() => {});
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  TYPING INDICATORS
// ══════════════════════════════════════════════════════════════
function listenTyping() {
  if (!currentRoomId) return;
  const r  = ref(db, `typing/${currentRoomId}`);
  const fn = snap => {
    if (!snap.exists()) { $("typingBar").classList.add("hidden"); return; }
    const others = [];
    snap.forEach(child => {
      if (child.key !== me.id && child.val() === true) {
        const u = allUsers[child.key];
        others.push(u ? u.name : child.key);
      }
    });
    if (others.length > 0) {
      $("typingText").textContent = others.join(", ") + (others.length === 1 ? " is" : " are") + " typing";
      $("typingBar").classList.remove("hidden");
    } else {
      $("typingBar").classList.add("hidden");
    }
  };
  onValue(r, fn);
  activeListeners.push({ r, fn });
}

$("msgInput").addEventListener("input", () => {
  setTyping(true);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => setTyping(false), 2000);
});
$("msgInput").addEventListener("blur", () => { clearTimeout(typingTimer); setTyping(false); });

async function setTyping(val) {
  if (!me || !currentRoomId) return;
  try { await set(ref(db, `typing/${currentRoomId}/${me.id}`), val || null); } catch(_) {}
}
async function clearTypingFlag() {
  if (!me || !currentRoomId) return;
  try { await remove(ref(db, `typing/${currentRoomId}/${me.id}`)); } catch(_) {}
}

// ══════════════════════════════════════════════════════════════
//  ATTACHMENT PANEL
// ══════════════════════════════════════════════════════════════
const attachMenu = $("attachMenu");
$("attachBtn").addEventListener("click", e => {
  e.stopPropagation();
  const open = !attachMenu.classList.contains("hidden");
  attachMenu.classList.toggle("hidden", open);
  if (!open) attachMenu.style.display = "flex";
});
document.addEventListener("click", () => { attachMenu.classList.add("hidden"); });

// Gallery
$("galleryBtn").addEventListener("click", () => { $("galleryInput").click(); attachMenu.classList.add("hidden"); });
$("galleryInput").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  const b64 = await fileToB64(f);
  await sendMessage({ type: "image", media: b64, text: "" });
  e.target.value = "";
});

// Camera
$("cameraBtn").addEventListener("click", async () => {
  attachMenu.classList.add("hidden");
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: true });
    $("camVideo").srcObject = camStream;
    $("cameraModal").classList.remove("hidden");
    $("cameraModal").classList.add("fc");
  } catch(_) { showToast("Camera access denied.", true); }
});

$("snapBtn").addEventListener("click", () => {
  const v = $("camVideo"), c = $("camCanvas");
  c.width = v.videoWidth || 640;
  c.height = v.videoHeight || 480;
  c.getContext("2d").drawImage(v, 0, 0);
  const b64 = c.toDataURL("image/jpeg", 0.85);
  sendMessage({ type: "image", media: b64, text: "" });
  closeCam();
});

$("closeCam").addEventListener("click", closeCam);
function closeCam() {
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  $("camVideo").srcObject = null;
  $("cameraModal").classList.add("hidden");
  $("cameraModal").classList.remove("fc");
}

// ══════════════════════════════════════════════════════════════
//  VOICE RECORDER
// ══════════════════════════════════════════════════════════════
$("micBtn").addEventListener("click", startRec);

async function startRec() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recChunks = [];
    mediaRec  = new MediaRecorder(stream);

    // Push every available chunk as it arrives.
    mediaRec.ondataavailable = e => {
      if (e.data && e.data.size > 0) recChunks.push(e.data);
    };

    // Only build & send the Blob once the recorder has fully stopped —
    // this guarantees every chunk (including the final flush) is captured
    // before FileReader ever touches the data.
    mediaRec.onstop = handleRecStop;

    // Request a dataavailable event periodically so chunks accumulate
    // even on long recordings, in addition to the final flush on stop.
    mediaRec.start(250);

    recSecs = 0;
    $("recTimer").textContent = "0:00";
    recInterval = setInterval(() => {
      recSecs++;
      const m = Math.floor(recSecs / 60), s = recSecs % 60;
      $("recTimer").textContent = `${m}:${s.toString().padStart(2,"0")}`;
    }, 1000);
    $("voiceUI").classList.remove("hidden");
    $("voiceUI").classList.add("flex");
    $("normalInput").classList.add("hidden");
  } catch(_) { showToast("Microphone access denied.", true); }
}

$("stopRec").addEventListener("click", () => {
  if (mediaRec && mediaRec.state !== "inactive") mediaRec.stop();
});
$("cancelRec").addEventListener("click", () => {
  if (mediaRec && mediaRec.state !== "inactive") {
    mediaRec.onstop = () => { stopRecUI(); }; // cancel: stop UI, don't send
    mediaRec.stop();
  } else {
    stopRecUI();
  }
});

async function handleRecStop() {
  stopRecUI();
  if (recChunks.length === 0) { showToast("Recording was empty.", true); return; }
  // Combine every collected chunk into a single Blob before converting,
  // so the resulting audio is never missing its tail end.
  const blob = new Blob(recChunks, { type: recChunks[0].type || "audio/webm" });
  recChunks = [];
  try {
    const b64 = await fileToB64(blob);
    await sendMessage({ type: "audio", media: b64, text: "" });
  } catch (_) {
    showToast("Failed to process voice note.", true);
  }
}

function stopRecUI() {
  clearInterval(recInterval);
  $("voiceUI").classList.add("hidden");
  $("voiceUI").classList.remove("flex");
  $("normalInput").classList.remove("hidden");
  if (mediaRec?.stream) mediaRec.stream.getTracks().forEach(t => t.stop());
}

// ══════════════════════════════════════════════════════════════
//  EDIT PROFILE
// ══════════════════════════════════════════════════════════════
let editAvatarB64 = null;

$("openEditProfile").addEventListener("click", () => {
  editAvatarB64 = null;
  $("editName").value = me.name;
  $("editAvatarPreview").innerHTML = `<img src="${me.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"/>
    <label class="absolute inset-0 fc cursor-pointer" style="background:rgba(0,0,0,0.4);opacity:0;transition:opacity .15s;" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0">
      <svg style="width:20px;height:20px;color:#fff;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
      <input id="editPhoto" type="file" accept="image/*" class="hidden"/>
    </label>`;
  $("editPhoto").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    editAvatarB64 = await fileToB64(file);
    $("editAvatarPreview").querySelector("img").src = editAvatarB64;
  });
  $("editError").textContent = "";
  $("editProfileModal").classList.remove("hidden");
  $("editProfileModal").classList.add("fc");
});
$("closeEditProfile").addEventListener("click", () => {
  $("editProfileModal").classList.add("hidden");
  $("editProfileModal").classList.remove("fc");
});

$("saveProfile").addEventListener("click", async () => {
  const newName = $("editName").value.trim();
  const errEl = $("editError");
  if (!newName) { errEl.textContent = "Display name can't be empty."; return; }

  const updates = { name: newName };
  if (editAvatarB64) updates.avatar = editAvatarB64;

  try {
    await update(ref(db, `users/${me.id}`), updates);
    me.name = newName;
    if (editAvatarB64) me.avatar = editAvatarB64;
    $("myName").textContent = me.name;
    $("myAvatar").src = me.avatar;
    $("editProfileModal").classList.add("hidden");
    $("editProfileModal").classList.remove("fc");
    showToast("Profile updated.");
  } catch (_) {
    errEl.textContent = "Something went wrong.";
  }
});

// ══════════════════════════════════════════════════════════════
//  MAINTENANCE PANEL  (visible only to MAINTAINER_NAME)
//
//  Scope, by design:
//   • Can clear the shared group chat.
//   • Can purge stale base64 media (images/audio) older than 12h,
//     across the group chat AND direct-message rooms, to keep the
//     free Firebase tier under its storage limits.
//   • Can fully reset the demo database for a clean slate.
//  It deliberately has NO way to list DM room names, open a DM, or
//  read anyone's private messages — that capability does not exist
//  anywhere in this codebase, for any account, including this one.
// ══════════════════════════════════════════════════════════════
$("openAdminPanel").addEventListener("click", () => {
  $("adminStatus").textContent = "";
  $("adminModal").classList.remove("hidden");
  $("adminModal").classList.add("fc");
});
$("closeAdmin").addEventListener("click", () => {
  $("adminModal").classList.add("hidden");
  $("adminModal").classList.remove("fc");
});

$("wipeGroupBtn").addEventListener("click", async () => {
  const ok = await confirmDialog("Wipe group chat?", "This permanently deletes every message in the Main Group Chat for everyone. This can't be undone.");
  if (!ok) return;
  try {
    await remove(ref(db, "chats/group"));
    $("adminStatus").textContent = "Group chat cleared.";
    showToast("Group chat wiped.");
  } catch (_) {
    $("adminStatus").textContent = "Failed to wipe group chat.";
  }
});

$("storageCleanupBtn").addEventListener("click", async () => {
  $("adminStatus").textContent = "Cleaning up…";
  try {
    const removed = await cleanupOldMedia();
    $("adminStatus").textContent = `Removed ${removed} old media message(s).`;
    showToast("Storage cleanup complete.");
  } catch (_) {
    $("adminStatus").textContent = "Cleanup failed.";
  }
});

$("resetDbBtn").addEventListener("click", async () => {
  const ok = await confirmDialog(
    "Full database reset?",
    "This wipes ALL data — every account, every group message, and every direct message for everyone. This is meant for resetting a test/demo database and cannot be undone."
  );
  if (!ok) return;
  const ok2 = await confirmDialog("Really sure?", "Last check — this action is permanent and irreversible.");
  if (!ok2) return;
  try {
    await remove(ref(db, "/"));
    $("adminStatus").textContent = "Database reset.";
    showToast("Database fully reset.");
  } catch (_) {
    $("adminStatus").textContent = "Reset failed.";
  }
});

// Scans group + all direct-message rooms (by ID only, never displayed
// or opened) purely to delete stale media payloads and keep the
// Spark-plan database under its storage cap.
async function cleanupOldMedia() {
  const cutoff = Date.now() - CLEANUP_MS;
  let removedCount = 0;

  const groupSnap = await get(ref(db, "chats/group"));
  removedCount += await purgeOldMediaInRoom("chats/group", groupSnap.val());

  const directSnap = await get(ref(db, "chats/direct"));
  const directRooms = directSnap.val() || {};
  for (const roomId of Object.keys(directRooms)) {
    removedCount += await purgeOldMediaInRoom(`chats/direct/${roomId}`, directRooms[roomId]);
  }
  return removedCount;
}

async function purgeOldMediaInRoom(path, messages) {
  if (!messages) return 0;
  const cutoff = Date.now() - CLEANUP_MS;
  let count = 0;
  for (const [msgId, msg] of Object.entries(messages)) {
    const hasMedia = msg.type === "image" || msg.type === "audio";
    if (hasMedia && msg.ts && msg.ts < cutoff) {
      await remove(ref(db, `${path}/${msgId}`));
      count++;
    }
  }
  return count;
}

// ══════════════════════════════════════════════════════════════
//  48-HOUR CLIENT PURGE SWEEP
// ══════════════════════════════════════════════════════════════
async function runPurgeSweep() {
  if (!currentRoomPath) return;
  try {
    const snap = await get(ref(db, currentRoomPath));
    const data = snap.val();
    if (!data) return;
    const cutoff = Date.now() - TTL_MS;
    for (const [id, msg] of Object.entries(data)) {
      if (msg.ts && msg.ts < cutoff) {
        await remove(ref(db, `${currentRoomPath}/${id}`));
      }
    }
  } catch (_) { /* silent */ }
}

// ══════════════════════════════════════════════════════════════
//  MOBILE — long-press emoji & keyboard scroll fix
// ══════════════════════════════════════════════════════════════
let lpTimer = null;
document.addEventListener("touchstart", e => {
  const row = e.target.closest(".msg-row");
  if (!row) return;
  lpTimer = setTimeout(() => {
    const bar = row.querySelector(".emojis");
    if (bar) {
      bar.style.opacity = "1"; bar.style.pointerEvents = "auto";
      setTimeout(() => { bar.style.opacity = ""; bar.style.pointerEvents = ""; }, 3000);
    }
  }, 500);
}, { passive: true });
document.addEventListener("touchend", () => clearTimeout(lpTimer), { passive: true });

$("msgInput").addEventListener("focus", () => setTimeout(scrollBottom, 300));

// ══════════════════════════════════════════════════════════════
//  MODAL BACKDROP CLICKS
// ══════════════════════════════════════════════════════════════
$("editProfileModal").addEventListener("click", e => {
  if (e.target === $("editProfileModal")) { $("editProfileModal").classList.add("hidden"); $("editProfileModal").classList.remove("fc"); }
});
$("forgotModal").addEventListener("click", e => {
  if (e.target === $("forgotModal")) { $("forgotModal").classList.add("hidden"); $("forgotModal").classList.remove("fc"); }
});
$("cameraModal").addEventListener("click", e => { if (e.target === $("cameraModal")) closeCam(); });
$("adminModal").addEventListener("click", e => { if (e.target === $("adminModal")) { $("adminModal").classList.add("hidden"); $("adminModal").classList.remove("fc"); } });
