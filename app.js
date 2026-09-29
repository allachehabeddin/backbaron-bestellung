// طلبيات BackBaron: pick items per supplier, count cartons, send the order as a WhatsApp text.
// Data lives in Firebase (Auth + Firestore); the page itself is static and installs as a PWA.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, setDoc, addDoc,
  getDocs, onSnapshot, query, orderBy, limit, writeBatch }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = s => document.querySelector(s);
const ORDER = ["FSI", "Polat", "Best", "Selgros"];

// First-run defaults for the suppliers' letterheads and numbers (written once when the database is empty).
const DEFAULT_COMPANIES = {
  FSI: { header: "Guten Tag,\nIch bin Osama Chehab Eddin\nBack Baron S-Bhf Marzahn\nKunden Nr: 33005\nLieferdatum: {Lieferdatum}\n____________________",
         footer: "", whatsapp: "491631063333", email: "", askDate: true },
  Best: { header: "Slm\nBackshop\nChehab Eddin Ossama\nMarzahner Promenade 1/s-Bhf\n12679 Berlin\nKd-Nr: 16726",
          footer: "", whatsapp: "4915738344176", email: "", askDate: false },
  Polat: { header: "BackBaron – S-Bhf Marzahn", footer: "", whatsapp: "4917612341416", email: "", askDate: false },
  Selgros: { header: "BackBaron – S-Bhf Marzahn", footer: "", whatsapp: "", email: "", askDate: false },
};

if (!firebaseConfig.apiKey) {
  $("#loginView").hidden = false;
  $("#lStatus").textContent = "لم يُربط التطبيق بـFirebase بعد (firebase-config.js فارغ).";
  $("#lGo").disabled = true;
  throw new Error("firebase-config.js is empty");
}
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

const S = { user: null, catalog: {}, companies: {}, drafts: {}, orders: [], cur: null, q: "", onlyPicked: false, lief: "", test: null };
const itemKey = it => it.code ? "c:" + it.code : "n:" + it.name;
const pad = n => String(n).padStart(2, "0");
const deDate = iso => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return d + "." + m + "." + y; };
const WD = ["So.", "Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa."];
const isoOf = t => t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate());
const dateOf = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const tomorrowIso = () => isoOf(new Date(Date.now() + 864e5));
function status(t, warn) { const el = $("#status"); el.textContent = t || ""; el.classList.toggle("warn", !!warn); }

// test mode is per device: each person tries it on their own phone
try { S.test = JSON.parse(localStorage.getItem("bb-test") || "null"); } catch (e) {}
const testOn = () => !!(S.test && S.test.on && S.test.number);

// ---------------------------------------------------------------- login

onAuthStateChanged(auth, user => {
  S.user = user;
  $("#loginView").hidden = !!user;
  $("#appView").hidden = !user;
  if (user) { $("#who").textContent = user.email; start(); }
});
$("#lGo").onclick = async () => {
  $("#lStatus").textContent = "";
  try { await signInWithEmailAndPassword(auth, $("#lEmail").value.trim(), $("#lPass").value); }
  catch (e) { $("#lStatus").textContent = "الإيميل أو كلمة المرور غير صحيحة"; }
};
$("#lPass").addEventListener("keydown", e => { if (e.key === "Enter") $("#lGo").click(); });
$("#btnLogout").onclick = () => signOut(auth).then(() => location.reload());

// ---------------------------------------------------------------- lists

function companies() {
  const names = Object.keys(S.catalog);
  return ORDER.filter(n => names.includes(n)).concat(names.filter(n => !ORDER.includes(n)).sort());
}
const qtyOf = co => (S.drafts[co] && S.drafts[co].qty) || {};
const pickedCount = co => Object.values(qtyOf(co)).filter(v => v > 0).length;

function renderTabs() {
  const tabs = $("#tabs"); tabs.textContent = "";
  for (const co of companies()) {
    const b = document.createElement("button");
    b.className = "tab"; b.type = "button"; b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(co === S.cur));
    b.append(co);
    const n = pickedCount(co);
    if (n) { const s = document.createElement("span"); s.className = "n"; s.textContent = n; b.append(s); }
    b.onclick = () => { S.cur = co; S.q = ""; $("#q").value = ""; render(); };
    tabs.append(b);
  }
}

const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");

function renderList() {
  const list = $("#list"); list.textContent = "";
  const items = (S.catalog[S.cur] && S.catalog[S.cur].items) || [];
  const qty = qtyOf(S.cur);
  const words = norm(S.q).split(/\s+/).filter(Boolean);
  const shown = items.filter(it => {
    if (S.onlyPicked && !(qty[itemKey(it)] > 0)) return false;
    const hay = norm(it.code + " " + it.name + " " + it.unit);
    return words.every(w => hay.includes(w));
  });
  if (!shown.length) {
    const e = document.createElement("div"); e.className = "empty";
    e.textContent = items.length ? "لا توجد أصناف تطابق البحث" : "لا أصناف بعد. اضغط «تحديث الأصناف من الإكسل» واختر ملف أسعار الموردين";
    list.append(e); return;
  }
  for (const it of shown) {
    const k = itemKey(it), v = qty[k] || 0;
    const row = document.createElement("div"); row.className = "row" + (v > 0 ? " picked" : "");
    const left = document.createElement("div");
    const nm = document.createElement("div"); nm.className = "name"; nm.dir = "auto"; nm.textContent = it.name;
    const meta = document.createElement("div"); meta.className = "meta";
    if (it.code) { const c = document.createElement("span"); c.textContent = "#" + it.code; meta.append(c); }
    const u = [it.unit, it.pack ? it.pack + " stk" : ""].filter(Boolean).join(" · ");
    if (u) { const c = document.createElement("span"); c.dir = "ltr"; c.textContent = u; meta.append(c); }
    left.append(nm, meta);
    const q = document.createElement("div"); q.className = "qty";
    const minus = document.createElement("button"); minus.type = "button"; minus.textContent = "−"; minus.setAttribute("aria-label", "أنقص");
    const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "numeric"; inp.value = v || ""; inp.placeholder = "0";
    inp.setAttribute("aria-label", "عدد الكراتين: " + it.name);
    const plus = document.createElement("button"); plus.type = "button"; plus.textContent = "+"; plus.setAttribute("aria-label", "زِد");
    const setV = n => { n = Math.max(0, Math.min(999, n | 0)); setQty(k, n); inp.value = n || ""; row.classList.toggle("picked", n > 0); };
    minus.onclick = () => setV((qtyOf(S.cur)[k] || 0) - 1);
    plus.onclick = () => setV((qtyOf(S.cur)[k] || 0) + 1);
    inp.oninput = () => { inp.value = inp.value.replace(/\D/g, ""); setV(parseInt(inp.value || "0", 10)); };
    q.append(minus, inp, plus);
    row.append(left, q);
    list.append(row);
  }
}

function renderCount() {
  const lines = orderLines(S.cur);
  const n = lines.length, tot = lines.reduce((a, l) => a + l.qty, 0);
  $("#count").innerHTML = n ? "<b>" + n + "</b> صنف · <b>" + tot + "</b> كرتون" : "لا أصناف مختارة";
  $("#btnReview").disabled = !n;
}

function render() {
  renderTabs(); renderList(); renderCount(); showTestBar();
  $("#onlyPicked").setAttribute("aria-pressed", String(S.onlyPicked));
}

// quantities: shared in drafts/<company> so the three users see one list; one write per pause
const timers = {};
function setQty(k, n) {
  const co = S.cur;
  const d = S.drafts[co] = { qty: Object.assign({}, qtyOf(co)) };
  if (n > 0) d.qty[k] = n; else delete d.qty[k];
  renderTabs(); renderCount();
  clearTimeout(timers[co]);
  timers[co] = setTimeout(() => {
    setDoc(doc(db, "drafts", co), { qty: S.drafts[co].qty, updatedAt: new Date().toISOString(), by: S.user.email })
      .catch(e => status("لم تُحفظ الكميات: " + (e && e.message || e), true))
      .finally(() => { timers[co] = null; });
  }, 700);
}

function orderLines(co) {
  const items = (S.catalog[co] && S.catalog[co].items) || [];
  const qty = qtyOf(co);
  return items.filter(it => qty[itemKey(it)] > 0).map(it => ({ code: it.code, name: it.name, qty: qty[itemKey(it)] }));
}

// ---------------------------------------------------------------- the message

// WhatsApp shows text between ``` in a fixed-width font, about 25–28 characters wide on a phone, so the
// WhatsApp table is built to that width: code | name | cartons, a long name wrapped under its own column.
function buildMessage(co, forWhatsApp) {
  const c = S.companies[co] || {};
  const lines = orderLines(co);
  const hasCode = lines.some(l => l.code);
  const head = (c.header || "BackBaron – S-Bhf Marzahn").replace(/\{Lieferdatum\}/g, deDate(S.lief));
  const WIDTH = 25;   // iPhone 11 Pro fits 26 fixed-width characters, Android 28: keep one to spare
  let table;
  if (forWhatsApp) {
    const cw = hasCode ? Math.max(4, ...lines.map(l => (l.code || "-").length)) : 0;
    const qw = Math.max(3, ...lines.map(l => String(l.qty).length));
    const room = Math.max(10, WIDTH - (hasCode ? cw + 1 : 0) - qw - 1);
    const wrap = name => {
      const out = []; let cur = "";
      for (const word of name.split(/\s+/)) {
        if (!cur) cur = word;
        else if ((cur + " " + word).length <= room) cur += " " + word;
        else { out.push(cur); cur = word; }
        while (cur.length > room) { out.push(cur.slice(0, room - 1) + "-"); cur = cur.slice(room - 1); }   // a word longer than the column
      }
      if (cur) out.push(cur);
      return out;
    };
    const codeCell = x => hasCode ? x.padEnd(cw) + " " : "";
    const indent = codeCell("");
    const rows = [codeCell("Art.") + "Artikel".padEnd(room) + " " + "Ktn".padStart(qw), "-".repeat(WIDTH)];
    lines.forEach(l => {
      const parts = wrap(l.name);
      rows.push(codeCell(l.code || "-") + parts[0].padEnd(room) + " " + String(l.qty).padStart(qw));
      parts.slice(1).forEach(p => rows.push(indent + p));
    });
    table = rows.join("\n");
  } else {
    const head2 = hasCode ? "Art.-Nr. | Artikel | Menge (Ktn)" : "Artikel | Menge (Ktn)";
    table = [head2].concat(lines.map(l => (hasCode ? [l.code || "-", l.name, l.qty] : [l.name, l.qty]).join(" | "))).join("\n");
  }
  let text = head.trim() + "\n\n" + (forWhatsApp ? "```\n" + table + "\n```" : table);
  if (c.footer && c.footer.trim()) text += "\n\n" + c.footer.trim();
  return text;
}

function showDate() { $("#lieferdatum").value = deDate(S.lief); $("#dDay").textContent = S.lief ? WD[dateOf(S.lief).getDay()] : ""; $("#lieferdatum").classList.remove("warn"); }
function shiftDate(n) { const t = dateOf(S.lief || tomorrowIso()); t.setDate(t.getDate() + n); S.lief = isoOf(t); showDate(); refreshSend(); }

function openSend() {
  const c = S.companies[S.cur] || {};
  $("#sendTitle").textContent = "طلب " + S.cur;
  $("#dateWrap").hidden = !c.askDate;
  if (!S.lief) S.lief = tomorrowIso();
  showDate();
  refreshSend();
  $("#sheetSend").hidden = false;
}

function refreshSend() {
  const c = S.companies[S.cur] || {};
  const text = buildMessage(S.cur, false);
  const waText = buildMessage(S.cur, true);
  $("#msg").textContent = waText.replace(/```\n?/g, "");   // show the table as WhatsApp will
  // the supplier must never receive Arabic, whatever language the screen is in
  const AR = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
  const bad = text.split("\n").filter(l => AR.test(l));
  const w = $("#arWarn");
  w.hidden = !bad.length;
  w.textContent = bad.length ? "في الرسالة كلام عربي، فأوقفت الإرسال. صحّح هذا السطر في «إعدادات الشركة» أو في ملف الإكسل: " + bad.join(" / ") : "";
  ["#aWa", "#aMail", "#btnCopy"].forEach(id => { $(id).classList.toggle("blocked", !!bad.length); $(id).setAttribute("aria-disabled", String(!!bad.length)); });
  const test = testOn();
  const wa = (test ? S.test.number : (c.whatsapp || "")).replace(/\D/g, "");
  $("#aMail").classList.toggle("blocked", test || bad.length > 0);
  $("#aMail").hidden = !c.email;   // a company without a saved address (Polat: WhatsApp only) shows no email button
  $("#aWa").href = "https://wa.me/" + wa + "?text=" + encodeURIComponent(waText);
  const subj = "Bestellung BackBaron S-Bhf Marzahn" + (c.askDate ? " – Lieferdatum " + deDate(S.lief) : "");
  $("#aMail").href = "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(c.email || "") +
    "&su=" + encodeURIComponent(subj) + "&body=" + encodeURIComponent(text);
  const to = [];
  if (test) to.push("وضع التجربة: يذهب الواتساب إلى رقمك +" + wa + " لا إلى " + S.cur);
  else if (wa) to.push("واتساب: +" + wa); else to.push("لا رقم واتساب محفوظ – سيطلب منك واتساب اختيار المحادثة");
  if (c.email) to.push("إيميل: " + c.email);
  $("#toLine").textContent = "";
  to.forEach(t => { const d = document.createElement("div"); d.className = "addr"; d.dir = "auto"; d.textContent = t; $("#toLine").append(d); });
}

$("#dPrev").onclick = () => shiftDate(-1);
$("#dNext").onclick = () => shiftDate(1);
// typed as 30.09.2026, 30.9.26 or 30.9 (year = this year)
$("#lieferdatum").addEventListener("change", e => {
  const m = e.target.value.trim().match(/^(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?$/);
  if (!m) { e.target.classList.add("warn"); return; }
  let y = m[3] ? +m[3] : new Date().getFullYear(); if (y < 100) y += 2000;
  const t = new Date(y, +m[2] - 1, +m[1]);
  if (t.getMonth() !== +m[2] - 1) { e.target.classList.add("warn"); return; }
  S.lief = isoOf(t); showDate(); refreshSend();
});
$("#btnReview").onclick = openSend;
$("#closeSend").onclick = () => { $("#sheetSend").hidden = true; };
$("#btnCopy").onclick = () => {
  const t = buildMessage(S.cur, true);   // copied for WhatsApp: keeps the fixed-width table
  const done = () => { $("#btnCopy").textContent = "نُسخ ✓"; setTimeout(() => $("#btnCopy").textContent = "نسخ النص", 1500); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, selectMsg);
  else selectMsg();
};
function selectMsg() { const r = document.createRange(); r.selectNodeContents($("#msg")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }

// Pressing WhatsApp or Email counts as sending: the order is saved with who sent it, and the
// quantities are cleared. Test mode saves nothing and keeps the quantities.
async function recordSent(via) {
  const co = S.cur;
  if (testOn()) return;
  const rec = { company: co, via, by: S.user.email, lines: orderLines(co),
                lieferdatum: (S.companies[co] || {}).askDate ? S.lief : "", sentAt: new Date().toISOString() };
  if (!rec.lines.length) return;
  try {
    await addDoc(collection(db, "orders"), rec);
    S.drafts[co] = { qty: {} };
    await setDoc(doc(db, "drafts", co), { qty: {}, updatedAt: rec.sentAt, by: S.user.email });
    $("#sheetSend").hidden = true;
    status("حُفظ طلب " + co + " في «آخر طلب» وفُرّغت الكميات");
    render();
  } catch (e) { status("لم يُحفظ الطلب: " + (e && e.message || e), true); }
}
$("#aWa").addEventListener("click", () => { recordSent("whatsapp"); });
$("#aMail").addEventListener("click", () => { recordSent("email"); });

// ---------------------------------------------------------------- test mode (this device only)

function showTestBar() {
  const on = testOn();
  $("#testBar").hidden = !on;
  $("#testBar").textContent = on ? "وضع التجربة مفعّل على هذا الجهاز: كل واتساب يذهب إلى رقمك +" + S.test.number + " — لا إلى الشركات" : "";
}
$("#btnTest").onclick = () => {
  $("#tNum").value = (S.test && S.test.number) || ""; $("#tOn").checked = !!(S.test && S.test.on);
  $("#testStatus").textContent = ""; $("#sheetTest").hidden = false;
};
$("#closeTest").onclick = () => { $("#sheetTest").hidden = true; };
$("#saveTest").onclick = () => {
  const t = { number: $("#tNum").value.replace(/\D/g, ""), on: $("#tOn").checked };
  if (t.on && t.number.length < 8) { $("#testStatus").textContent = "اكتب رقمك كاملاً مع رمز الدولة"; return; }
  S.test = t;
  try { localStorage.setItem("bb-test", JSON.stringify(t)); } catch (e) {}
  showTestBar(); $("#sheetTest").hidden = true;
};

// ---------------------------------------------------------------- previous orders

$("#lastOrder").onclick = () => {
  const list = $("#histList"); list.textContent = "";
  const mine = S.orders.filter(o => o.company === S.cur).slice(0, 15);
  if (!mine.length) { const e = document.createElement("div"); e.className = "note"; e.textContent = "لا طلبات محفوظة لهذه الشركة بعد"; list.append(e); }
  for (const o of mine) {
    const b = document.createElement("button"); b.type = "button";
    const d = new Date(o.sentAt);
    b.textContent = d.getDate() + "." + (d.getMonth() + 1) + "." + d.getFullYear() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) +
      " — " + o.lines.length + " صنف · " + o.lines.reduce((a, l) => a + l.qty, 0) + " كرتون" + (o.by ? " · " + o.by.split("@")[0] : "");
    b.onclick = () => {
      const items = (S.catalog[S.cur] && S.catalog[S.cur].items) || [];
      S.drafts[S.cur] = { qty: {} };
      for (const l of o.lines) {
        const it = items.find(x => (l.code && x.code === l.code) || (!l.code && x.name === l.name));
        if (it) setQty(itemKey(it), l.qty);
      }
      $("#sheetHist").hidden = true; S.onlyPicked = true; render();
    };
    list.append(b);
  }
  $("#sheetHist").hidden = false;
};
$("#closeHist").onclick = () => { $("#sheetHist").hidden = true; };

$("#onlyPicked").onclick = () => { S.onlyPicked = !S.onlyPicked; render(); };
$("#clearAll").onclick = () => {
  const b = $("#clearAll");
  if (b.dataset.armed) { delete b.dataset.armed; b.textContent = "تفريغ الكميات"; Object.keys(qtyOf(S.cur)).forEach(k => setQty(k, 0)); renderList(); return; }
  b.dataset.armed = "1"; b.textContent = "اضغط مرة أخرى للتأكيد";
  setTimeout(() => { if (b.dataset.armed) { delete b.dataset.armed; b.textContent = "تفريغ الكميات"; } }, 3000);
};
let qt; $("#q").addEventListener("input", e => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value; renderList(); }, 120); });

// ---------------------------------------------------------------- company settings

$("#btnSettings").onclick = () => {
  const c = S.companies[S.cur] || {};
  $("#setTitle").textContent = "إعدادات " + S.cur;
  $("#sHeader").value = c.header || ""; $("#sFooter").value = c.footer || "";
  $("#sWa").value = c.whatsapp || ""; $("#sMail").value = c.email || ""; $("#sDate").checked = !!c.askDate;
  $("#setStatus").textContent = "";
  $("#sheetSettings").hidden = false;
};
$("#btnSettings2").onclick = () => { $("#sheetSend").hidden = true; $("#btnSettings").click(); };
$("#closeSettings").onclick = () => { $("#sheetSettings").hidden = true; };
$("#saveSettings").onclick = async () => {
  const c = { header: $("#sHeader").value, footer: $("#sFooter").value, whatsapp: $("#sWa").value.replace(/\D/g, ""),
              email: $("#sMail").value.trim(), askDate: $("#sDate").checked };
  try { await setDoc(doc(db, "companies", S.cur), c); $("#sheetSettings").hidden = true; status("حُفظت إعدادات " + S.cur); }
  catch (e) { $("#setStatus").textContent = "لم تُحفظ: " + (e && e.message || e); }
};

// ---------------------------------------------------------------- import from أسعار الموردين.xlsm

$("#btnImport").onclick = () => $("#fileXl").click();
$("#fileXl").onchange = async e => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  if (typeof XLSX === "undefined") { status("تعذّر تحميل قارئ الإكسل، تأكد من الإنترنت وأعد فتح التطبيق", true); return; }
  try {
    status("جارٍ قراءة " + f.name + "…");
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
    const found = [];
    const batch = writeBatch(db);
    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn];
      if (sn === "_template" || !ws.Z1 || String(ws.Z1.v) !== "company") continue;   // the company sheets carry "company" in Z1
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 3, blankrows: false, defval: "" });
      const items = rows.filter(r => String(r[2]).trim()).map(r => ({
        code: String(r[1] ?? "").trim(), name: String(r[2]).trim(), unit: String(r[3] ?? "").trim(),
        pack: Number.isFinite(+r[7]) && String(r[7]) !== "" ? Math.round(+r[7]) : null }));
      batch.set(doc(db, "catalog", sn), { items, updatedAt: new Date().toISOString(), by: S.user.email });
      found.push(sn + " (" + items.length + ")");
    }
    if (!found.length) { status("لم أجد أوراق شركات في هذا الملف. اختر ملف «أسعار الموردين.xlsm»", true); return; }
    await batch.commit();
    status("حُدّثت الأصناف: " + found.join("، "));
  } catch (err) { status("تعذّرت قراءة الملف: " + (err && err.message || err), true); }
};

// ---------------------------------------------------------------- live data

let started = false;
async function start() {
  if (started) return; started = true;
  render();
  // first run: write the suppliers' letterheads and numbers once
  try {
    const have = await getDocs(collection(db, "companies"));
    if (have.empty) {
      const b = writeBatch(db);
      for (const [co, c] of Object.entries(DEFAULT_COMPANIES)) b.set(doc(db, "companies", co), c);
      await b.commit();
    }
  } catch (e) { status("تعذّر الاتصال بقاعدة البيانات: " + (e && e.message || e), true); }

  let first = true;
  onSnapshot(collection(db, "catalog"), snap => {
    S.catalog = {};
    snap.docs.forEach(d => { S.catalog[d.id] = d.data(); });
    if (!S.cur || !S.catalog[S.cur]) S.cur = companies()[0] || null;
    if (first) { first = false; status(""); }
    render();
  }, e => status("تعذّر تحميل الأصناف: " + e.message, true));
  onSnapshot(collection(db, "companies"), snap => { snap.docs.forEach(d => { S.companies[d.id] = d.data(); }); }, () => {});
  onSnapshot(collection(db, "drafts"), snap => {
    let changed = false;
    snap.docs.forEach(d => {
      if (d.metadata.hasPendingWrites || timers[d.id]) return;   // this device has unsaved typing
      const q = (d.data() || {}).qty || {};
      if (JSON.stringify(q) !== JSON.stringify(qtyOf(d.id))) { S.drafts[d.id] = { qty: q }; changed = true; }
    });
    if (changed) render();
  }, () => {});
  onSnapshot(query(collection(db, "orders"), orderBy("sentAt", "desc"), limit(300)), snap => {
    S.orders = snap.docs.map(d => d.data());
  }, () => {});
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
