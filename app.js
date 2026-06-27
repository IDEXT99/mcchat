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
const TTL_MS        = 172_800_000;   // 48 hours
const CLEANUP_MS    = 43_200_000;    // 12 hours
const REACTIONS     = ["❤️","😂","😮","😢","👍"];
const EMOJI_GRID    = [
  "😀","😂","😍","🥰","😎","🤔","😭","😡","🥳","😴",
  "👍","👎","👏","🙏","💪","🔥","✨","🎉","💯","❤️",
  "😢","😮","😅","🙄","😇","🤝","👀","💀","🤯","😤",
  "🍕","☕","🎮","⚽","🚀","🌙","☀️","🌧️","🎵","📸",
];

const MAINTAINER_NAME = "sachu";
const MAINTAINER_PASS = "riya";

const ICE_SERVERS = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// ══════════════════════════════════════════════════════════════
//  App State
// ══════════════════════════════════════════════════════════════
let me              = null;
let currentRoomPath = null;
let currentRoomId   = null;
let currentDmPeerId = null;  // other user's id when in a DM
let allUsers        = {};
let activeListeners = [];
let typingTimer     = null;
let mediaRec        = null;
let recInterval     = null;
let recSecs         = 0;
let recChunks       = [];
let camStream       = null;

// Reply state
let replyTo         = null;  // { id, senderName, text }

// WebRTC state
let peerConn        = null;
let localStream     = null;
let callRoomId      = null;
let isCallInitiator = false;
let callVideoEnabled = true;
let callMuted        = false;
let facingMode       = "user";

// ══════════════════════════════════════════════════════════════
//  DOM helpers
// ══════════════════════════════════════════════════════════════
const $  = id => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  });
  children.forEach(c => c && e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return e;
};

// ══════════════════════════════════════════════════════════════
//  Utility
// ══════════════════════════════════════════════════════════════
function genAvatar(name = "?", color = "#00F2FE") {
  const initials = (name.slice(0, 2) || "??").toUpperCase();
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
  if (!ts || typeof ts !== "number") return "";
  return new Date(ts).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
}

function fmtLastSeen(ts) {
  if (!ts || typeof ts !== "number") return "a while ago";
  const d    = new Date(ts);
  const time = d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
  const date = d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" });
  const today = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" });
  return date === today ? `at ${time}` : `on ${date} at ${time}`;
}

function scrollBottom() {
  const area = $("msgArea");
  area.scrollTop = area.scrollHeight;
}

function showToast(msg, err = false) {
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:${err ? "#450a0a" : "#0f172a"};color:${err ? "#fca5a5" : "var(--accent)"};
    border:1px solid ${err ? "#7f1d1d" : "#252840"};border-radius:12px;
    padding:10px 20px;font-size:13px;z-index:9999;pointer-events:none;
    animation:fadeIn .25s ease;white-space:nowrap;max-width:90vw;`;
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
//  THEME ENGINE — listen to /settings/theme and apply CSS vars
// ══════════════════════════════════════════════════════════════
function listenTheme() {
  const r = ref(db, "settings/theme");
  const fn = snap => {
    const t = snap.val();
    if (!t) return;
    const root = document.documentElement;
    if (t.bg)        root.style.setProperty("--bg-primary", t.bg);
    if (t.container) root.style.setProperty("--bg-container", t.container);
    if (t.accent) {
      root.style.setProperty("--accent", t.accent);
      root.style.setProperty("--accent-dim", t.accent);
      root.style.setProperty("--accent-muted", t.accent + "1f");
    }
    // Sync admin pickers to current theme
    if ($("themeBg")) { $("themeBg").value = t.bg || "#090A0F"; $("themeBgHex").textContent = t.bg || "#090A0F"; }
    if ($("themeContainer")) { $("themeContainer").value = t.container || "#141622"; $("themeContainerHex").textContent = t.container || "#141622"; }
    if ($("themeAccent")) { $("themeAccent").value = t.accent || "#00F2FE"; $("themeAccentHex").textContent = t.accent || "#00F2FE"; }
  };
  onValue(r, fn);
  // Keep outside activeListeners — we want theme to persist across room switches
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
    setTimeout(() => { gateInput.classList.remove("animate-shake"); gateInput.style.borderColor = ""; }, 450);
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
}

function afterGate() {
  listenTheme();
  const savedId = localStorage.getItem("nc_session");
  if (savedId) resumeSession(savedId);
  else $("authHub").classList.remove("hidden");
}

async function resumeSession(userId) {
  try {
    const snap = await get(ref(db, `users/${userId}`));
    if (!snap.exists()) { localStorage.removeItem("nc_session"); $("authHub").classList.remove("hidden"); return; }
    enterApp(userId, snap.val());
  } catch (_) { $("authHub").classList.remove("hidden"); }
}

// ══════════════════════════════════════════════════════════════
//  LAYER 2 — AUTH HUB
// ══════════════════════════════════════════════════════════════
function switchTab(tab) {
  const isLogin = tab === "login";
  $("tabLogin").className  = "flex-1 py-3.5 text-sm font-semibold transition-colors " + (isLogin  ? "tab-active" : "text-slate-500");
  $("tabCreate").className = "flex-1 py-3.5 text-sm font-semibold transition-colors " + (!isLogin ? "tab-active" : "text-slate-500");
  $("tabLogin").style.cssText  = `background:transparent;border:none;border-bottom:${isLogin  ? "2px solid var(--accent)" : "2px solid transparent"};cursor:pointer;`;
  $("tabCreate").style.cssText = `background:transparent;border:none;border-bottom:${!isLogin ? "2px solid var(--accent)" : "2px solid transparent"};cursor:pointer;`;
  $("panelLogin").className  = isLogin  ? "p-7 flex flex-col gap-4" : "hidden";
  $("panelCreate").className = !isLogin ? "p-7 flex flex-col gap-4" : "hidden";
}
window.switchTab = switchTab;

let regAvatarB64 = null;
$("regPhoto").addEventListener("change", async e => {
  const file = e.target.files[0]; if (!file) return;
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
  } catch (_) { errEl.textContent = "Something went wrong. Please try again."; }
});

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
  } catch (_) { errEl.textContent = "Something went wrong. Please try again."; }
});

[$("loginPass"), $("loginName")].forEach(e => e.addEventListener("keydown", ev => { if (ev.key === "Enter") $("loginBtn").click(); }));
[$("regName"), $("regPass")].forEach(e => e.addEventListener("keydown", ev => { if (ev.key === "Enter") $("registerBtn").click(); }));

// Forgot password
$("forgotLink").addEventListener("click", () => {
  $("forgotStep1").classList.remove("hidden"); $("forgotStep1").classList.add("flex");
  $("forgotStep2").classList.add("hidden"); $("forgotStep2").classList.remove("flex");
  $("forgotUsername").value = ""; $("forgotCode").value = ""; $("forgotError").textContent = "";
  $("forgotModal").classList.remove("hidden"); $("forgotModal").classList.add("fc");
});
$("closeForgot").addEventListener("click", () => { $("forgotModal").classList.add("hidden"); $("forgotModal").classList.remove("fc"); });

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
    $("forgotStep1").classList.add("hidden"); $("forgotStep1").classList.remove("flex");
    $("forgotStep2").classList.remove("hidden"); $("forgotStep2").classList.add("flex");
  } catch (_) { errEl.textContent = "Something went wrong."; }
});

$("forgotSaveBtn").addEventListener("click", async () => {
  const newPass = $("forgotNewPass").value.trim();
  const errEl = $("forgotError2");
  if (!newPass) { errEl.textContent = "Enter a new password."; return; }
  try {
    await update(ref(db, `users/${forgotUserId}`), { pass: newPass });
    showToast("Password updated. You can log in now.");
    $("forgotModal").classList.add("hidden"); $("forgotModal").classList.remove("fc");
  } catch (_) { errEl.textContent = "Something went wrong."; }
});

$("forgotModal").addEventListener("click", e => { if (e.target === $("forgotModal")) { $("forgotModal").classList.add("hidden"); $("forgotModal").classList.remove("fc"); } });

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

  if (me.isMaintainer) $("adminEntry").classList.remove("hidden");

  const presenceRef = ref(db, `users/${me.id}/presence`);
  set(presenceRef, { isOnline: true, lastSeen: serverTimestamp() });
  onDisconnect(presenceRef).set({ isOnline: false, lastSeen: serverTimestamp() });
  window.addEventListener("beforeunload", clearTypingFlag);

  listenUsers();
  openRoom("group", "Main Group Chat", null);
  runPurgeSweep();
  setInterval(runPurgeSweep, 60_000);
  listenIncomingCalls();
}

$("logoutBtn").addEventListener("click", () => {
  clearTypingFlag();
  endCall(true);
  set(ref(db, `users/${me.id}/presence`), { isOnline: false, lastSeen: serverTimestamp() }).catch(() => {});
  clearActiveListeners();
  localStorage.removeItem("nc_session");
  me = null; currentRoomId = null; currentRoomPath = null; currentDmPeerId = null;
  $("appShell").classList.add("hidden"); $("appShell").style.display = "none";
  $("adminEntry").classList.add("hidden");
  $("authHub").classList.remove("hidden");
  $("loginName").value = ""; $("loginPass").value = "";
});

// ══════════════════════════════════════════════════════════════
//  SIDEBAR — mobile drawer
// ══════════════════════════════════════════════════════════════
function openDrawer()  { $("sidebar").classList.add("drawer-open"); $("sidebarOverlay").style.display = "block"; }
function closeDrawer() { $("sidebar").classList.remove("drawer-open"); $("sidebarOverlay").style.display = "none"; }
$("hamburgerBtn").addEventListener("click", openDrawer);
$("closeSidebarBtn").addEventListener("click", closeDrawer);
$("sidebarOverlay").addEventListener("click", closeDrawer);

// ══════════════════════════════════════════════════════════════
//  USERS LIST → DM SIDEBAR
// ══════════════════════════════════════════════════════════════
function listenUsers() {
  const r = ref(db, "users");
  const fn = snap => { allUsers = snap.val() || {}; renderDmList(); };
  onValue(r, fn);
  activeListeners.push({ r, fn });
}

function renderDmList() {
  const list = $("dmList"); list.innerHTML = "";
  Object.entries(allUsers)
    .filter(([id]) => id !== me.id)
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .forEach(([id, u]) => {
      const row = el("div", {
        class: "sidebar-item flex items-center gap-3 px-5 py-2.5",
        id: `dmrow_${id}`,
        onclick: () => { openDm(id, u); closeDrawer(); }
      }, avatarImg(u.avatar || genAvatar(u.name), "30px"), el("span", { class: "text-sm flex-1 truncate" }, u.name));
      list.appendChild(row);
    });
}

function highlightActiveNav(activeEl) {
  document.querySelectorAll(".sidebar-item, #groupChannelBtn").forEach(e => e.classList.remove("nav-active"));
  activeEl.classList.add("nav-active");
}

$("groupChannelBtn").addEventListener("click", () => { openRoom("group", "Main Group Chat", null); highlightActiveNav($("groupChannelBtn")); closeDrawer(); });

function openDm(userId, userData) {
  const roomId = roomIdFor(me.id, userId);
  openRoom(roomId, userData.name, userData, userId);
  const row = $(`dmrow_${userId}`);
  if (row) highlightActiveNav(row);
}

// ══════════════════════════════════════════════════════════════
//  ROOM SWITCHING
// ══════════════════════════════════════════════════════════════
function openRoom(roomId, title, otherUser, otherUserId) {
  clearTypingFlag();
  clearActiveListeners();
  listenUsers();

  currentRoomId   = roomId;
  currentDmPeerId = otherUserId || null;
  currentRoomPath = roomId === "group" ? "chats/group" : `chats/direct/${roomId}`;

  // Reset reply state
  replyTo = null;
  $("replyPreview").classList.remove("active");

  $("headerTitle").textContent = title;
  if (roomId === "group") {
    $("headerSubtitle").textContent = "Everyone can see this channel";
    $("headerSubtitle").style.color = "#475569";
    $("headerAvatar").src = genAvatar("GC", "#00F2FE");
    $("callBtns").classList.add("hidden");
  } else {
    $("headerAvatar").src = (otherUser && otherUser.avatar) || genAvatar(title);
    $("callBtns").classList.remove("hidden");
    $("callBtns").style.display = "flex";
    listenPresence(otherUserId);
  }

  $("msgArea").innerHTML = "";
  listenMessages();
  listenTyping();
}

// ══════════════════════════════════════════════════════════════
//  PRESENCE
// ══════════════════════════════════════════════════════════════
function listenPresence(otherUserId) {
  if (!otherUserId) return;
  const r = ref(db, `users/${otherUserId}/presence`);
  const fn = snap => {
    const p = snap.val();
    const subtitle = $("headerSubtitle");
    if (!p || p.isOnline) {
      subtitle.innerHTML = `<span class="presence-dot"></span> <span style="color:var(--accent);">Online</span>`;
    } else {
      const lastSeenTs = typeof p.lastSeen === "number" ? p.lastSeen : null;
      subtitle.textContent = `Last seen ${fmtLastSeen(lastSeenTs)}`;
      subtitle.style.color = "#475569";
    }
  };
  onValue(r, fn);
  activeListeners.push({ r, fn });
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
      .sort((a, b) => a.id.localeCompare(b.id));
    renderMessages(msgs);
    updateSeenReceipts(msgs);
  };
  onValue(r, fn);
  activeListeners.push({ r, fn });
}

function renderMessages(msgs) {
  const area = $("msgArea");
  area.innerHTML = "";
  if (msgs.length === 0) {
    area.appendChild(el("div", { class: "fc flex-col gap-2 flex-1", style: "color:#334155;" }, el("p", { class: "text-sm" }, "No messages yet — say hi 👋")));
    return;
  }
  msgs.forEach(msg => area.appendChild(renderMessageRow(msg)));
  scrollBottom();
}

function renderMessageRow(msg) {
  const mine   = msg.senderId === me.id;
  const sender = allUsers[msg.senderId] || { name: msg.senderName || "Unknown", avatar: null };
  const isAudio = msg.type === "audio";

  const row = el("div", { class: `msg-row flex gap-2.5 relative ${mine ? "flex-row-reverse" : ""}` });

  // Touch swipe-to-reply
  let touchStartX = 0;
  row.addEventListener("touchstart", e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  row.addEventListener("touchend", e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (dx > 55) triggerReply(msg);
  }, { passive: true });

  // Right-click / long-press to reply (desktop)
  row.addEventListener("contextmenu", e => { e.preventDefault(); triggerReply(msg); });

  if (!mine) row.appendChild(avatarImg(sender.avatar || genAvatar(sender.name), "30px", "margin-top:2px;"));

  const col = el("div", { class: `flex flex-col gap-1 ${isAudio ? "shrink-0" : "max-w-[78%]"} ${mine ? "items-end" : "items-start"}` });

  if (!mine && currentRoomId === "group") {
    col.appendChild(el("span", { class: "text-xs px-1", style: "color:#475569;" }, sender.name));
  }

  const bubble = el("div", {
    class: `relative rounded-xl ${isAudio ? "audio-bubble" : "px-3.5 py-2.5"} ${mine ? "bubble-out" : "bubble-in"}`,
    style: "word-break:break-word;"
  });

  // Reply-to quote inside bubble
  if (msg.replyTo) {
    const quote = el("div", {
      class: "reply-quote",
      onclick: () => scrollToMessage(msg.replyTo.id)
    });
    quote.innerHTML = `<span style="color:var(--accent);font-weight:600;">${escapeHtml(msg.replyTo.senderName)}</span><br>${escapeHtml((msg.replyTo.text || "[media]").slice(0, 60))}`;
    bubble.appendChild(quote);
  }

  if (msg.editing && mine) {
    const input = el("input", { class: "edit-field", value: msg.text || "" });
    const saveRow = el("div", { class: "flex gap-2 mt-2" },
      el("button", { class: "btn-neon text-xs px-3 py-1 rounded-lg", onclick: () => saveEdit(msg.id, input.value) }, "Save"),
      el("button", { class: "btn-ghost text-xs px-3 py-1 rounded-lg", onclick: () => cancelEdit(msg.id) }, "Cancel")
    );
    bubble.appendChild(input);
    bubble.appendChild(saveRow);
  } else {
    bubble.appendChild(renderMessageContent(msg));
  }

  bubble.id = `msg_${msg.id}`;
  col.appendChild(bubble);

  // Meta row
  const meta = el("div", { class: "flex items-center gap-1.5 px-1" },
    el("span", { class: "text-xs", style: "color:#475569;" }, fmtTime(msg.ts)),
    msg.edited ? el("span", { class: "text-xs", style: "color:#475569;" }, "· edited") : null,
  );
  if (mine && currentRoomId !== "group") {
    meta.appendChild(el("span", { class: msg.seen ? "tick-double" : "tick-single" }));
  }
  col.appendChild(meta);

  // Reactions
  if (msg.reactions && Object.keys(msg.reactions).length) {
    const reactRow = el("div", { class: "flex gap-1 px-1 flex-wrap" });
    const counts = {};
    Object.values(msg.reactions).forEach(e => { counts[e] = (counts[e] || 0) + 1; });
    Object.entries(counts).forEach(([emoji, count]) => {
      reactRow.appendChild(el("span", { class: "react-badge", onclick: () => addReaction(msg.id, emoji) }, `${emoji} ${count > 1 ? count : ""}`));
    });
    col.appendChild(reactRow);
  }

  row.appendChild(col);

  // Hover actions
  const actionsWrap = el("div", { class: `flex flex-col gap-1 ${mine ? "items-end" : "items-start"} justify-center` });
  const emojiBar = el("div", { class: "emojis flex gap-1 px-1" });
  REACTIONS.forEach(e => {
    emojiBar.appendChild(el("button", {
      class: "text-sm transition-transform hover:scale-125",
      style: "background:none;border:none;cursor:pointer;",
      onclick: () => addReaction(msg.id, e)
    }, e));
  });
  actionsWrap.appendChild(emojiBar);

  if (mine && !msg.editing) {
    const msgActions = el("div", { class: "msg-actions flex gap-2 px-1" });
    if (msg.type === "text" || !msg.type) {
      msgActions.appendChild(el("button", { class: "text-xs", style: "background:none;border:none;cursor:pointer;color:#64748b;", onclick: () => startEdit(msg) }, "Edit"));
    }
    msgActions.appendChild(el("button", { class: "text-xs", style: "background:none;border:none;cursor:pointer;color:#f87171;", onclick: () => deleteMsg(msg.id) }, "Del"));
    actionsWrap.appendChild(msgActions);
  }

  // Reply button (non-mine)
  const replyBtn = el("button", {
    class: "msg-actions text-xs",
    style: "background:none;border:none;cursor:pointer;color:#64748b;",
    onclick: () => triggerReply(msg)
  }, "↩");
  actionsWrap.appendChild(replyBtn);

  row.appendChild(actionsWrap);
  return row;
}

function scrollToMessage(msgId) {
  const target = document.getElementById(`msg_${msgId}`);
  if (target) { target.scrollIntoView({ behavior: "smooth", block: "center" }); target.style.outline = "2px solid var(--accent)"; setTimeout(() => target.style.outline = "", 1500); }
}

function renderMessageContent(msg) {
  if (msg.type === "image") {
    const img = el("img", { style: "max-width:220px;border-radius:12px;display:block;cursor:pointer;", src: msg.media });
    img.addEventListener("click", () => window.open(msg.media, "_blank"));
    return img;
  }
  if (msg.type === "audio") {
    const wrap = el("div", { class: "w-[250px] sm:w-[300px] min-w-[200px] max-w-full flex-shrink-0" });
    const audio = el("audio", { controls: "true", src: msg.media, preload: "metadata", class: "w-full min-w-[200px] h-10 outline-none flex-shrink-0" });
    wrap.appendChild(audio);
    return wrap;
  }
  return el("span", { class: "text-sm whitespace-pre-wrap" }, msg.text || "");
}

// ══════════════════════════════════════════════════════════════
//  REPLY
// ══════════════════════════════════════════════════════════════
function triggerReply(msg) {
  const sender = allUsers[msg.senderId] || { name: msg.senderName || "?" };
  replyTo = { id: msg.id, senderName: sender.name, text: msg.text || (msg.type === "image" ? "[photo]" : "[voice]") };
  $("replyToName").textContent = replyTo.senderName;
  $("replyToPreview").textContent = replyTo.text.slice(0, 50);
  $("replyPreview").classList.add("active");
  $("msgInput").focus();
}

$("cancelReply").addEventListener("click", () => {
  replyTo = null;
  $("replyPreview").classList.remove("active");
});

// ══════════════════════════════════════════════════════════════
//  SEND MESSAGE
// ══════════════════════════════════════════════════════════════
async function sendMessage({ type = "text", text = "", media = null } = {}) {
  if (!me || !currentRoomPath) return;
  if (type === "text" && !text.trim()) return;

  const payload = {
    senderId: me.id, senderName: me.name,
    type, text: type === "text" ? text.trim() : "",
    ts: serverTimestamp(), seen: false,
  };
  if (media) payload.media = media;
  if (replyTo) { payload.replyTo = { ...replyTo }; }

  try {
    await push(ref(db, currentRoomPath), payload);
    replyTo = null;
    $("replyPreview").classList.remove("active");
    setTyping(false);
    scrollBottom();
  } catch (_) { showToast("Failed to send message.", true); }
}

$("sendBtn").addEventListener("click", () => {
  const input = $("msgInput");
  const text = input.value;
  if (!text.trim()) return;
  sendMessage({ type: "text", text });
  input.value = ""; input.style.height = "auto";
});

$("msgInput").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("sendBtn").click(); } });
$("msgInput").addEventListener("input", () => { const e = $("msgInput"); e.style.height = "auto"; e.style.height = Math.min(e.scrollHeight, 110) + "px"; });
$("msgInput").addEventListener("focus", () => setTimeout(scrollBottom, 300));

// ══════════════════════════════════════════════════════════════
//  EDIT / DELETE / REACTIONS / SEEN
// ══════════════════════════════════════════════════════════════
function startEdit(msg)       { update(ref(db, `${currentRoomPath}/${msg.id}`), { editing: true }).catch(() => {}); }
async function saveEdit(id, t) { if (!t.trim()) return; await update(ref(db, `${currentRoomPath}/${id}`), { text: t.trim(), edited: true, editing: false }); }
async function cancelEdit(id)  { await update(ref(db, `${currentRoomPath}/${id}`), { editing: false }); }
async function deleteMsg(id)   { await remove(ref(db, `${currentRoomPath}/${id}`)); }
async function addReaction(id, emoji) { await set(ref(db, `${currentRoomPath}/${id}/reactions/${me.id}`), emoji); }

function updateSeenReceipts(msgs) {
  if (!currentRoomId || currentRoomId === "group") return;
  msgs.forEach(msg => { if (msg.senderId !== me.id && !msg.seen) update(ref(db, `${currentRoomPath}/${msg.id}`), { seen: true }).catch(() => {}); });
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
    snap.forEach(child => { if (child.key !== me.id && child.val() === true) { const u = allUsers[child.key]; others.push(u ? u.name : child.key); } });
    if (others.length > 0) {
      $("typingText").textContent = others.join(", ") + (others.length === 1 ? " is" : " are") + " typing";
      $("typingBar").classList.remove("hidden");
    } else { $("typingBar").classList.add("hidden"); }
  };
  onValue(r, fn);
  activeListeners.push({ r, fn });
}

$("msgInput").addEventListener("input",  () => { setTyping(true); clearTimeout(typingTimer); typingTimer = setTimeout(() => setTyping(false), 2000); });
$("msgInput").addEventListener("blur",   () => { clearTimeout(typingTimer); setTyping(false); });
async function setTyping(val) { if (!me || !currentRoomId) return; try { await set(ref(db, `typing/${currentRoomId}/${me.id}`), val || null); } catch(_){} }
async function clearTypingFlag() { if (!me || !currentRoomId) return; try { await remove(ref(db, `typing/${currentRoomId}/${me.id}`)); } catch(_){} }

// ══════════════════════════════════════════════════════════════
//  EMOJI PICKER
// ══════════════════════════════════════════════════════════════
const emojiPicker = $("emojiPicker");
EMOJI_GRID.forEach(e => {
  const btn = el("button", { type: "button", style: "background:none;border:none;cursor:pointer;font-size:18px;padding:4px;border-radius:6px;" }, e);
  btn.addEventListener("mousedown", evt => {
    evt.preventDefault();
    const input = $("msgInput");
    const start = input.selectionStart ?? input.value.length;
    const end   = input.selectionEnd   ?? input.value.length;
    input.value = input.value.slice(0, start) + e + input.value.slice(end);
    const pos = start + e.length;
    input.focus(); input.setSelectionRange(pos, pos);
    input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 110) + "px";
  });
  emojiPicker.appendChild(btn);
});

$("emojiBtn").addEventListener("click", evt => {
  evt.stopPropagation();
  const open = emojiPicker.classList.contains("open");
  emojiPicker.classList.toggle("open", !open);
});
document.addEventListener("click", e => { if (!emojiPicker.contains(e.target) && e.target !== $("emojiBtn")) emojiPicker.classList.remove("open"); });

// ══════════════════════════════════════════════════════════════
//  ATTACHMENT PANEL
// ══════════════════════════════════════════════════════════════
const attachMenu = $("attachMenu");
$("attachBtn").addEventListener("click", evt => { evt.stopPropagation(); attachMenu.classList.toggle("open"); });
document.addEventListener("click", e => { if (!attachMenu.contains(e.target) && e.target !== $("attachBtn")) attachMenu.classList.remove("open"); });

$("galleryBtn").addEventListener("click", () => { $("galleryInput").click(); attachMenu.classList.remove("open"); });
$("galleryInput").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  const b64 = await fileToB64(f);
  await sendMessage({ type: "image", media: b64, text: "" });
  e.target.value = "";
});

$("cameraBtn").addEventListener("click", async () => {
  attachMenu.classList.remove("open");
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: true });
    $("camVideo").srcObject = camStream;
    $("cameraModal").classList.remove("hidden"); $("cameraModal").classList.add("fc");
  } catch(_) { showToast("Camera access denied.", true); }
});

$("snapBtn").addEventListener("click", () => {
  const v = $("camVideo"), c = $("camCanvas");
  c.width = v.videoWidth || 640; c.height = v.videoHeight || 480;
  c.getContext("2d").drawImage(v, 0, 0);
  sendMessage({ type: "image", media: c.toDataURL("image/jpeg", 0.85), text: "" });
  closeCam();
});

$("closeCam").addEventListener("click", closeCam);
$("cameraModal").addEventListener("click", e => { if (e.target === $("cameraModal")) closeCam(); });
function closeCam() {
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  $("camVideo").srcObject = null;
  $("cameraModal").classList.add("hidden"); $("cameraModal").classList.remove("fc");
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
    mediaRec.ondataavailable = e => { if (e.data && e.data.size > 0) recChunks.push(e.data); };
    mediaRec.onstop = handleRecStop;
    mediaRec.start(250);
    recSecs = 0; $("recTimer").textContent = "0:00";
    recInterval = setInterval(() => {
      recSecs++;
      const m = Math.floor(recSecs / 60), s = recSecs % 60;
      $("recTimer").textContent = `${m}:${s.toString().padStart(2, "0")}`;
    }, 1000);
    $("voiceUI").classList.remove("hidden"); $("voiceUI").classList.add("flex");
    $("normalInput").classList.add("hidden");
  } catch(_) { showToast("Microphone access denied.", true); }
}

$("stopRec").addEventListener("click", () => { if (mediaRec && mediaRec.state !== "inactive") mediaRec.stop(); });
$("cancelRec").addEventListener("click", () => {
  if (mediaRec && mediaRec.state !== "inactive") { mediaRec.onstop = () => stopRecUI(); mediaRec.stop(); }
  else stopRecUI();
});

async function handleRecStop() {
  stopRecUI();
  if (recChunks.length === 0) { showToast("Recording was empty.", true); return; }
  const blob = new Blob(recChunks, { type: recChunks[0].type || "audio/webm" });
  recChunks = [];
  try { const b64 = await fileToB64(blob); await sendMessage({ type: "audio", media: b64, text: "" }); }
  catch (_) { showToast("Failed to process voice note.", true); }
}

function stopRecUI() {
  clearInterval(recInterval);
  $("voiceUI").classList.add("hidden"); $("voiceUI").classList.remove("flex");
  $("normalInput").classList.remove("hidden");
  if (mediaRec?.stream) mediaRec.stream.getTracks().forEach(t => t.stop());
}

// ══════════════════════════════════════════════════════════════
//  WEBRTC — CALLING
// ══════════════════════════════════════════════════════════════
async function startCall(withVideo) {
  if (!currentDmPeerId) { showToast("Open a DM first to call.", true); return; }
  if (peerConn) { showToast("Already in a call.", true); return; }

  callRoomId     = roomIdFor(me.id, currentDmPeerId);
  isCallInitiator = true;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo ? { facingMode } : false });
  } catch(_) { showToast("Couldn't access camera/microphone.", true); return; }

  $("localVideo").srcObject = localStream;
  peerConn = new RTCPeerConnection(ICE_SERVERS);

  localStream.getTracks().forEach(t => peerConn.addTrack(t, localStream));

  peerConn.ontrack = e => { $("remoteVideo").srcObject = e.streams[0]; };

  peerConn.onicecandidate = e => {
    if (e.candidate) push(ref(db, `calls/${callRoomId}/callerCandidates`), e.candidate.toJSON());
  };

  // Write offer
  const offer = await peerConn.createOffer();
  await peerConn.setLocalDescription(offer);
  await set(ref(db, `calls/${callRoomId}/offer`), { sdp: offer.sdp, type: offer.type, from: me.id, name: me.name, withVideo });

  // Show call UI
  showCallOverlay("Calling " + (allUsers[currentDmPeerId]?.name || currentDmPeerId) + "…");

  // Listen for answer
  const answerRef = ref(db, `calls/${callRoomId}/answer`);
  const candidatesRef = ref(db, `calls/${callRoomId}/calleeCandidates`);
  const unsubAnswer = onValue(answerRef, async snap => {
    const ans = snap.val();
    if (ans && !peerConn.remoteDescription) {
      await peerConn.setRemoteDescription(new RTCSessionDescription(ans));
      $("callStatus").textContent = "Connected";
      off(answerRef, "value", unsubAnswer);
    }
  });
  onValue(candidatesRef, snap => {
    snap.forEach(child => { const c = child.val(); if (c) peerConn.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}); });
  });
}

function listenIncomingCalls() {
  // Watch all call rooms that include our ID
  const callsRef = ref(db, "calls");
  const fn = snap => {
    if (!snap.exists()) return;
    snap.forEach(roomSnap => {
      const roomId = roomSnap.key;
      if (!roomId.includes(me.id)) return;
      const offer = roomSnap.val()?.offer;
      if (!offer || offer.from === me.id) return;
      // Only show if no answer yet and no active call
      const answer = roomSnap.val()?.answer;
      if (answer || peerConn) return;
      showIncomingCall(offer, roomId);
    });
  };
  onValue(callsRef, fn);
  // Keep outside activeListeners (global app-level listener)
}

function showIncomingCall(offer, roomId) {
  $("incomingCallerName").textContent = offer.name || "Someone";
  const modal = $("incomingCallModal");
  modal.classList.add("active");

  const onAccept = async () => {
    modal.classList.remove("active");
    cleanup();
    await acceptCall(offer, roomId);
  };
  const onDecline = () => {
    modal.classList.remove("active");
    cleanup();
    remove(ref(db, `calls/${roomId}`)).catch(() => {});
  };

  const cleanup = () => {
    $("acceptCallBtn").removeEventListener("click", onAccept);
    $("declineCallBtn").removeEventListener("click", onDecline);
  };

  $("acceptCallBtn").addEventListener("click", onAccept, { once: true });
  $("declineCallBtn").addEventListener("click", onDecline, { once: true });
}

async function acceptCall(offer, roomId) {
  callRoomId      = roomId;
  isCallInitiator = false;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: offer.withVideo ? { facingMode } : false });
  } catch(_) { showToast("Couldn't access camera/microphone.", true); return; }

  $("localVideo").srcObject = localStream;
  peerConn = new RTCPeerConnection(ICE_SERVERS);
  localStream.getTracks().forEach(t => peerConn.addTrack(t, localStream));

  peerConn.ontrack = e => { $("remoteVideo").srcObject = e.streams[0]; };
  peerConn.onicecandidate = e => {
    if (e.candidate) push(ref(db, `calls/${callRoomId}/calleeCandidates`), e.candidate.toJSON());
  };

  await peerConn.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConn.createAnswer();
  await peerConn.setLocalDescription(answer);
  await set(ref(db, `calls/${callRoomId}/answer`), { sdp: answer.sdp, type: answer.type });

  // Pull caller's ICE candidates
  onValue(ref(db, `calls/${callRoomId}/callerCandidates`), snap => {
    snap.forEach(child => { const c = child.val(); if (c) peerConn.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}); });
  });

  showCallOverlay("Connected");
}

function showCallOverlay(statusText) {
  $("callStatus").textContent = statusText;
  $("callOverlay").classList.add("active");
  $("callVideoToggleBtn").style.opacity = "1";
}

function endCall(silent = false) {
  if (peerConn) { peerConn.close(); peerConn = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  $("remoteVideo").srcObject = null;
  $("localVideo").srcObject  = null;
  $("callOverlay").classList.remove("active");
  if (callRoomId && !silent) remove(ref(db, `calls/${callRoomId}`)).catch(() => {});
  callRoomId = null;
}

$("hangUpBtn").addEventListener("click", () => endCall(false));

$("callMuteBtn").addEventListener("click", () => {
  callMuted = !callMuted;
  if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = !callMuted; });
  $("callMuteBtn").style.opacity = callMuted ? "0.5" : "1";
});

$("callVideoToggleBtn").addEventListener("click", () => {
  callVideoEnabled = !callVideoEnabled;
  if (localStream) localStream.getVideoTracks().forEach(t => { t.enabled = callVideoEnabled; });
  $("callVideoToggleBtn").style.opacity = callVideoEnabled ? "1" : "0.5";
});

$("callFlipBtn").addEventListener("click", async () => {
  if (!peerConn || !localStream) return;
  facingMode = facingMode === "user" ? "environment" : "user";
  const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: true }).catch(() => null);
  if (!newStream) return;
  const videoTrack = newStream.getVideoTracks()[0];
  const sender = peerConn.getSenders().find(s => s.track?.kind === "video");
  if (sender && videoTrack) sender.replaceTrack(videoTrack);
  localStream.getVideoTracks().forEach(t => t.stop());
  $("localVideo").srcObject = newStream;
  localStream = newStream;
});

// Call header buttons
$("voiceCallBtn").addEventListener("click", () => startCall(false));
$("videoCallBtn").addEventListener("click", () => startCall(true));

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
  document.getElementById("editPhoto").addEventListener("change", async e => {
    const file = e.target.files[0]; if (!file) return;
    editAvatarB64 = await fileToB64(file);
    $("editAvatarPreview").querySelector("img").src = editAvatarB64;
  });
  $("editError").textContent = "";
  $("editProfileModal").classList.remove("hidden"); $("editProfileModal").classList.add("fc");
});
$("closeEditProfile").addEventListener("click", () => { $("editProfileModal").classList.add("hidden"); $("editProfileModal").classList.remove("fc"); });
$("editProfileModal").addEventListener("click", e => { if (e.target === $("editProfileModal")) { $("editProfileModal").classList.add("hidden"); $("editProfileModal").classList.remove("fc"); } });

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
    $("myName").textContent = me.name; $("myAvatar").src = me.avatar;
    $("editProfileModal").classList.add("hidden"); $("editProfileModal").classList.remove("fc");
    showToast("Profile updated.");
  } catch (_) { errEl.textContent = "Something went wrong."; }
});

// ══════════════════════════════════════════════════════════════
//  ADMIN / MAINTENANCE PANEL
// ══════════════════════════════════════════════════════════════
$("openAdminPanel").addEventListener("click", () => {
  $("adminStatus").textContent = "";
  $("adminModal").classList.remove("hidden"); $("adminModal").classList.add("fc");
  switchAdminTab("tools");
});
$("closeAdmin").addEventListener("click", () => { $("adminModal").classList.add("hidden"); $("adminModal").classList.remove("fc"); });
$("adminModal").addEventListener("click", e => { if (e.target === $("adminModal")) { $("adminModal").classList.add("hidden"); $("adminModal").classList.remove("fc"); } });

function switchAdminTab(tab) {
  const tabs = { tools: $("adminTabTools"), theme: $("adminTabTheme"), monitor: $("adminTabMonitor") };
  const panels = { tools: $("adminPanelTools"), theme: $("adminPanelTheme"), monitor: $("adminPanelMonitor") };
  Object.entries(tabs).forEach(([key, btn]) => {
    const active = key === tab;
    btn.className = `flex-1 py-2.5 text-xs font-semibold ${active ? "tab-active" : "text-slate-500"}`;
    btn.style.cssText = `background:transparent;border:none;border-bottom:${active ? "2px solid var(--accent)" : "2px solid transparent"};cursor:pointer;`;
    panels[key].classList.toggle("hidden", !active);
    if (active && panels[key].classList.contains("hidden")) panels[key].classList.remove("hidden");
  });
}
$("adminTabTools").addEventListener("click",   () => switchAdminTab("tools"));
$("adminTabTheme").addEventListener("click",   () => switchAdminTab("theme"));
$("adminTabMonitor").addEventListener("click", () => { switchAdminTab("monitor"); refreshMonitor(); });

// Tools
$("wipeGroupBtn").addEventListener("click", async () => {
  const ok = await confirmDialog("Wipe group chat?", "This permanently deletes every message in Main Group Chat for everyone.");
  if (!ok) return;
  try { await remove(ref(db, "chats/group")); $("adminStatus").textContent = "Group chat cleared."; showToast("Group chat wiped."); }
  catch (_) { $("adminStatus").textContent = "Failed."; }
});

$("storageCleanupBtn").addEventListener("click", async () => {
  $("adminStatus").textContent = "Cleaning up…";
  try { const n = await cleanupOldMedia(); $("adminStatus").textContent = `Removed ${n} old media message(s).`; showToast("Cleanup complete."); }
  catch (_) { $("adminStatus").textContent = "Cleanup failed."; }
});

$("resetDbBtn").addEventListener("click", async () => {
  const ok  = await confirmDialog("Full database reset?", "Wipes ALL data — every account and message. Irreversible.");
  if (!ok) return;
  const ok2 = await confirmDialog("Really sure?", "Last check — this is permanent and irreversible.");
  if (!ok2) return;
  try { await remove(ref(db, "/")); $("adminStatus").textContent = "Database reset."; showToast("Database fully reset."); }
  catch (_) { $("adminStatus").textContent = "Reset failed."; }
});

// Theme
["Bg","Container","Accent"].forEach(key => {
  const id = "theme" + key;
  $(`${id}`).addEventListener("input", e => { $(`${id}Hex`).textContent = e.target.value; });
});

$("saveThemeBtn").addEventListener("click", async () => {
  const t = { bg: $("themeBg").value, container: $("themeContainer").value, accent: $("themeAccent").value };
  try {
    await set(ref(db, "settings/theme"), t);
    $("themeStatus").textContent = "Theme applied globally.";
    showToast("Theme saved.");
  } catch (_) { $("themeStatus").textContent = "Failed to save."; }
});

$("resetThemeBtn").addEventListener("click", async () => {
  try {
    await set(ref(db, "settings/theme"), { bg: "#090A0F", container: "#141622", accent: "#00F2FE" });
    $("themeStatus").textContent = "Theme reset to default.";
  } catch (_) { $("themeStatus").textContent = "Failed."; }
});

// P2P Monitor
async function refreshMonitor() {
  const list = $("monitorList");
  list.innerHTML = "<span style='color:#475569;'>Loading…</span>";
  try {
    const snap = await get(ref(db, "calls"));
    const rooms = snap.val() || {};
    const keys = Object.keys(rooms);
    if (!keys.length) { list.innerHTML = "<span style='color:#475569;'>No active P2P rooms.</span>"; return; }
    list.innerHTML = "";
    keys.forEach(roomId => {
      const r = rooms[roomId];
      const row = el("div", { class: "flex items-center justify-between px-3 py-2 rounded-lg", style: "background:rgba(255,255,255,0.03);" },
        el("span", {}, roomId.replace("_", " ↔ ")),
        el("button", {
          class: "btn-danger text-xs px-2 py-1 rounded-lg",
          onclick: async () => { await remove(ref(db, `calls/${roomId}`)); refreshMonitor(); }
        }, "Kill")
      );
      list.appendChild(row);
    });
  } catch(_) { list.innerHTML = "<span style='color:#f87171;'>Error loading rooms.</span>"; }
}

$("refreshMonitorBtn").addEventListener("click", refreshMonitor);

// ══════════════════════════════════════════════════════════════
//  MEDIA CLEANUP
// ══════════════════════════════════════════════════════════════
async function cleanupOldMedia() {
  let count = 0;
  const groupSnap = await get(ref(db, "chats/group"));
  count += await purgeOldMediaInRoom("chats/group", groupSnap.val());
  const directSnap = await get(ref(db, "chats/direct"));
  const rooms = directSnap.val() || {};
  for (const roomId of Object.keys(rooms)) count += await purgeOldMediaInRoom(`chats/direct/${roomId}`, rooms[roomId]);
  return count;
}

async function purgeOldMediaInRoom(path, messages) {
  if (!messages) return 0;
  const cutoff = Date.now() - CLEANUP_MS;
  let count = 0;
  for (const [msgId, msg] of Object.entries(messages)) {
    if ((msg.type === "image" || msg.type === "audio") && msg.ts && msg.ts < cutoff) {
      await remove(ref(db, `${path}/${msgId}`)); count++;
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
    const data = snap.val(); if (!data) return;
    const cutoff = Date.now() - TTL_MS;
    for (const [id, msg] of Object.entries(data)) {
      if (msg.ts && msg.ts < cutoff) await remove(ref(db, `${currentRoomPath}/${id}`));
    }
  } catch(_) {}
}

// ══════════════════════════════════════════════════════════════
//  MOBILE — long-press emoji bar reveal + keyboard scroll fix
// ══════════════════════════════════════════════════════════════
let lpTimer = null;
document.addEventListener("touchstart", e => {
  const row = e.target.closest(".msg-row"); if (!row) return;
  lpTimer = setTimeout(() => {
    const bar = row.querySelector(".emojis");
    if (bar) { bar.style.opacity = "1"; bar.style.pointerEvents = "auto"; setTimeout(() => { bar.style.opacity = ""; bar.style.pointerEvents = ""; }, 3000); }
  }, 500);
}, { passive: true });
document.addEventListener("touchend", () => clearTimeout(lpTimer), { passive: true });
