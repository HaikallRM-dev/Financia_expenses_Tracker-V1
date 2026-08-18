(() => {
  "use strict";

  let currentProfile = "User";
  let transactions = [];
  let budgets = {};
  let showAll = false;
  let filterCat = null; // Phase 2: null = all categories
  let searchQ = ""; // Phase 10: search query
  let viewMonth = monthKey(new Date());
  let expenseChart = null;

  const DEFAULT_CATEGORIES = [
    { name: "Makanan", color: "#f97316" },
    { name: "Pengangkutan", color: "#3b82f6" },
    { name: "Belanja Rumah", color: "#14b8a6" },
    { name: "Bil & Utiliti", color: "#eab308" },
    { name: "Hiburan", color: "#ec4899" },
    { name: "Kesihatan", color: "#ef4444" },
    { name: "Pendidikan", color: "#8b5cf6" },
    { name: "Lain-lain", color: "#9a9aa5" },
  ];
  // Phase 5: dynamic categories (default + custom per-profile)
  function getCategories() {
    let custom = [];
    try { custom = JSON.parse(localStorage.getItem("fet_categories_" + currentProfile) || "[]"); }
    catch (e) { custom = []; }
    // merge: custom first, then defaults not already overridden
    const names = new Set(custom.map((c) => c.name));
    const merged = [...custom, ...DEFAULT_CATEGORIES.filter((c) => !names.has(c.name))];
    return merged;
  }
  function getCatMap() {
    const m = {};
    getCategories().forEach((c) => { m[c.name] = c.color; });
    return m;
  }
  let CATEGORIES = DEFAULT_CATEGORIES;
  let CAT_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.name, c.color]));

  const SUPABASE_TABLE = "Expenses"; // Jadual Supabase. Lajur: id(text PK), Title, Amount, Category, Date, note, created_at
  const PROFILE_KEY = "fet_active_profile";
  const LEGACY_KEY = "fet_transactions"; // Kunci lama (v1.1) untuk migration

  // ---- Storage keys (per-profile) ----
  const TX_KEY = () => "fet_transactions_" + currentProfile;
  const BUDGET_KEY = () => "fet_budgets_" + currentProfile;

  const $ = (id) => document.getElementById(id);
  const els = {
    amount: $("amount"),
    category: $("category"),
    date: $("date"),
    note: $("note"),
    form: $("expenseForm"),
    snackbar: $("snackbar"),
    monthTotal: $("monthTotal"),
    monthCount: $("monthCount"),
    monthAvg: $("monthAvg"),
    monthRange: $("monthRange"),
    allTotal: $("allTotal"),
    allCount: $("allCount"),
    breakdown: $("breakdown"),
    txList: $("txList"),
    monthLabel: $("monthLabel"),
    prevMonth: $("prevMonth"),
    nextMonth: $("nextMonth"),
    allToggle: $("allToggle"),
    profileChip: $("profileChip"),
    profileInitial: $("profileInitial"),
    profileName: $("profileName"),
    exportCsvBtn: $("exportCsvBtn"),
    exportJsonBtn: $("exportJsonBtn"),
    importBtn: $("importBtn"),
    importFile: $("importFile"),
    budgetInput: $("budgetInput"),
    budgetMonth: $("budgetMonth"),
    budgetFig: $("budgetFig"),
    budgetFill: $("budgetFill"),
    budgetMsg: $("budgetMsg"),
    themeToggle: $("themeToggle"),
    receiptInput: $("receiptInput"),
  };

  function monthKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  function fmtRM(n) {
    return "RM " + Number(n).toLocaleString("ms-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function monthName(ym) {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("ms-MY", { month: "long", year: "numeric" });
  }
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function showSnack(msg, ok = true) {
    els.snackbar.textContent = msg;
    els.snackbar.className = "snackbar show " + (ok ? "ok" : "err");
    clearTimeout(showSnack._t);
    showSnack._t = setTimeout(() => { els.snackbar.className = "snackbar"; }, 2600);
  }

  // ============================================================
  // PERSISTENCE — localStorage sebagai SUMBER KEBENARAN (offline-safe)
  // Supabase HANYA lapisan sync (best-effort, tak halang app jalan).
  // ============================================================
  function save() {
    try {
      localStorage.setItem(TX_KEY(), JSON.stringify(transactions));
    } catch (e) {
      showSnack("Gagal simpan lokal: " + e.message, false);
    }
  }

  function loadLocal() {
    currentProfile = localStorage.getItem(PROFILE_KEY) || "User";
    try {
      transactions = JSON.parse(localStorage.getItem(TX_KEY()) || "[]");
      if (!Array.isArray(transactions)) transactions = [];
    } catch { transactions = []; }
    try {
      budgets = JSON.parse(localStorage.getItem(BUDGET_KEY()) || "{}");
      if (typeof budgets !== "object" || budgets === null) budgets = {};
    } catch { budgets = {}; }
    migrateLegacy();
  }

  // S5: baca data lama (v1.1, kunci tunggal) sekali sahaja supaya tak "hilang"
  function migrateLegacy() {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return;
    try {
      const old = JSON.parse(legacy);
      if (Array.isArray(old) && old.length) {
        const map = new Map(transactions.map((t) => [t.id, t]));
        let added = 0;
        old.forEach((t) => {
          if (t && t.id && typeof t.amount === "number" && t.date && !map.has(t.id)) {
            map.set(t.id, { ...t, profile: currentProfile });
            added++;
          }
        });
        if (added) {
          transactions = [...map.values()];
          save();
          showSnack("Data lama (v1.1) dipulihkan: " + added + " rekod.", true);
        }
      }
      localStorage.removeItem(LEGACY_KEY);
    } catch { /* abaikan blob lama rosak */ }
  }

  // ---- Cloud mapping (Supabase <-> app) ----
  function toRow(t) {
    return {
      id: t.id,
      Title: t.note || t.category,
      Amount: t.amount,
      Category: t.category,
      Date: t.date,
      note: t.note || "",
    };
  }
  function mapRow(item) {
    return {
      id: String(item.id),
      amount: Number(item.Amount != null ? item.Amount : item.amount || 0),
      category: item.Category || item.category || "Lain-lain",
      date: item.Date || item.date || (item.created_at ? String(item.created_at).split("T")[0] : todayISO()),
      note: item.note != null ? item.note : (item.Title || ""),
      createdAt: item.created_at ? new Date(item.created_at).getTime() : Date.now(),
    };
  }

  // ---- Cloud sync (best-effort) ----
  function sb() { return window.supabaseClient || null; }

  async function syncFromCloud() {
    const client = sb();
    if (!client) return;
    try {
      const { data, error } = await client.from(SUPABASE_TABLE).select("*");
      if (error) throw error;
      const remote = (data || []).map(mapRow);
      const map = new Map(transactions.map((t) => [t.id, t]));
      let changed = false;
      remote.forEach((r) => {
        if (r && r.id && !map.has(r.id)) { map.set(r.id, r); changed = true; }
      });
      if (changed) {
        transactions = [...map.values()];
        save();
        render();
      }
    } catch (e) {
      console.warn("Cloud pull dilewati (offline/ralat):", e.message);
    }
  }

  async function pushToCloud(t) {
    const client = sb();
    if (!client) return;
    try {
      const { error } = await client.from(SUPABASE_TABLE).upsert(toRow(t), { onConflict: "id" });
      if (error) throw error;
    } catch (e) {
      console.warn("Cloud push dilewati:", e.message);
    }
  }

  async function deleteFromCloud(id) {
    const client = sb();
    if (!client) return;
    try {
      await client.from(SUPABASE_TABLE).delete().eq("id", id);
    } catch (e) {
      console.warn("Cloud delete dilewati:", e.message);
    }
  }

  function loadData() {
    loadLocal();
    // Cuba sync dari cloud di latar belakang (tak sekat paparan).
    if (sb()) syncFromCloud();
  }

  // ============================================================
  // RENDER
  // ============================================================
  function render() {
    let scope = showAll ? transactions : transactions.filter((t) => monthKey(new Date(t.date)) === viewMonth);
    if (filterCat) scope = scope.filter((t) => t.category === filterCat);
    if (searchQ) {
      const q = searchQ.toLowerCase();
      scope = scope.filter((t) => (t.note || "").toLowerCase().includes(q) || (t.category || "").toLowerCase().includes(q));
    }
    const monthTx = transactions.filter((t) => monthKey(new Date(t.date)) === viewMonth);
    const mTotal = monthTx.reduce((s, t) => s + t.amount, 0);
    const aTotal = transactions.reduce((s, t) => s + t.amount, 0);

    els.monthTotal.textContent = fmtRM(mTotal);
    els.monthCount.textContent = monthTx.length;
    els.monthAvg.textContent = "Purata " + fmtRM(monthTx.length ? mTotal / monthTx.length : 0) + " / transaksi";
    els.monthRange.textContent = monthName(viewMonth);

    els.allTotal.textContent = fmtRM(aTotal);
    els.allCount.textContent = transactions.length + " transaksi direkod";

    // Phase 6: balance (income - expense)
    const incTotal = transactions.filter((t) => t.type === "inc").reduce((s, t) => s + t.amount, 0);
    const balance = incTotal - aTotal;
    const balEl = document.getElementById("balanceTotal");
    const balMeta = document.getElementById("balanceMeta");
    if (balEl) {
      balEl.textContent = fmtRM(balance);
      balEl.style.color = balance >= 0 ? "var(--emerald-2)" : "var(--danger)";
    }
    if (balMeta) balMeta.textContent = "Pendapatan " + fmtRM(incTotal) + " • Belanja " + fmtRM(aTotal);

    const byCat = {};
    scope.forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
    const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const max = entries.length ? entries[0][1] : 0;
    const catColorMap = getCatMap();

    if (!entries.length) {
      els.breakdown.innerHTML = `<div class="bd-empty">Tiada perbelanjaan lagi. Tambah rekod di sebelah kiri.</div>`;
    } else {
      els.breakdown.innerHTML = entries.map(([cat, amt]) => {
        const color = catColorMap[cat] || "#9a9aa5";
        const pct = max ? (amt / max) * 100 : 0;
        return `<div class="bd-row">
          <div class="bd-top"><span class="bd-cat">${escapeHtml(cat)}</span><span class="bd-amt">${fmtRM(amt)}</span></div>
          <div class="bd-bar"><div class="bd-fill" style="width:${pct}%;background:${color}"></div></div>
        </div>`;
      }).join("");
    }

    renderChart(entries);

    const sorted = [...scope].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
    if (!sorted.length) {
      els.txList.innerHTML = `<div class="empty">${showAll ? "Tiada rekod." : "Tiada perbelanjaan untuk " + monthName(viewMonth) + "."}</div>`;
    } else {
      els.txList.innerHTML = sorted.map((t) => {
        const color = CAT_MAP[t.category] || "#9a9aa5";
        const isInc = t.type === "inc";
        const ds = new Date(t.date).toLocaleDateString("ms-MY", { day: "numeric", month: "short", year: "numeric" });
        const amtTxt = (isInc ? "+" : "−") + fmtRM(t.amount).replace("RM ", "");
        return `<div class="tx ${isInc ? "inc" : ""}">
          <span class="tx-dot" style="background:${color}"></span>
          <div class="tx-main">
            <div class="tx-cat">${escapeHtml(t.category)} ${isInc ? "💰" : ""}</div>
            <div class="tx-note">${t.note ? escapeHtml(t.note) : ds}</div>
          </div>
          <div class="tx-right">
            <span class="tx-amt ${isInc ? "inc-amt" : ""}">${amtTxt}</span>
            <span class="tx-date">${ds}</span>
          </div>
          ${t.receipt ? `<button class="tx-receipt" data-receipt="${t.id}" title="Lihat resit">📸</button>` : ""}
          <button class="tx-edit" data-id="${t.id}" title="Edit">✏️</button>
          <button class="tx-del" data-id="${t.id}" title="Padam">✕</button>
        </div>`;
      }).join("");
    }

    els.monthLabel.textContent = showAll ? "Semua" : monthName(viewMonth);
    els.allToggle.classList.toggle("active", showAll);
    renderProfile();
    renderBudget();
    renderCatFilter();
    renderInsights();
    renderCompare();
  }

  function renderChart(entries) {
    const ctx = document.getElementById("expenseChart").getContext("2d");
    const labels = entries.map((e) => e[0]);
    const data = entries.map((e) => e[1]);
    const colors = labels.map((l) => CAT_MAP[l] || "#9a9aa5");

    if (expenseChart) expenseChart.destroy();
    if (!labels.length) return;

    expenseChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: labels,
        datasets: [{ data: data, backgroundColor: colors, borderWidth: 0 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        cutout: "65%",
      },
    });
  }

  function renderProfile() {
    els.profileName.textContent = currentProfile;
    els.profileInitial.textContent = currentProfile.charAt(0).toUpperCase();
  }

  // Phase 9: Monthly Comparison card
  function renderCompare() {
    const curEl = document.getElementById("cmpCur");
    const prevEl = document.getElementById("cmpPrev");
    const deltaEl = document.getElementById("cmpDelta");
    const arrowEl = document.getElementById("cmpArrow");
    if (!curEl) return;
    const [y, m] = viewMonth.split("-").map(Number);
    const prevKey = monthKey(new Date(y, m - 2, 1));
    const curTotal = transactions.filter((t) => t.type !== "inc" && monthKey(new Date(t.date)) === viewMonth).reduce((s, t) => s + t.amount, 0);
    const prevTotal = transactions.filter((t) => t.type !== "inc" && monthKey(new Date(t.date)) === prevKey).reduce((s, t) => s + t.amount, 0);
    curEl.textContent = fmtRM(curTotal);
    prevEl.textContent = fmtRM(prevTotal);
    if (prevTotal > 0) {
      const pct = Math.round(((curTotal - prevTotal) / prevTotal) * 100);
      const up = pct > 0;
      deltaEl.textContent = (up ? "Naik " : "Turun ") + Math.abs(pct) + "% berbanding " + monthName(prevKey);
      deltaEl.className = "compare-delta " + (up ? "warn" : "good");
      arrowEl.textContent = up ? "↑" : "↓";
    } else {
      deltaEl.textContent = prevTotal === 0 ? "Tiada data bulan lepas." : "";
      deltaEl.className = "compare-delta";
      arrowEl.textContent = "→";
    }
  }

  // Phase 2: category filter chips
  function renderCatFilter() {
    const wrap = document.getElementById("catFilter");
    if (!wrap) return;
    const cats = getCategories().map((c) => c.name);
    const cmap = getCatMap();
    let html = `<button class="chip ${!filterCat ? "active" : ""}" data-cat="">Semua Kategori</button>`;
    html += cats.map((c) => `<button class="chip ${filterCat === c ? "active" : ""}" data-cat="${c}" style="--chip:${cmap[c]}">${c}</button>`).join("");
    wrap.innerHTML = html;
    wrap.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const c = btn.dataset.cat;
        filterCat = c || null;
        render();
      });
    });
  }

  // Phase 4: Financial Insights — banding bulan ini vs bulan lepas
  function renderInsights() {
    const wrap = document.getElementById("insightsList");
    if (!wrap) return;
    const [y, m] = viewMonth.split("-").map(Number);
    const prevKey = monthKey(new Date(y, m - 2, 1));
    const cur = transactions.filter((t) => monthKey(new Date(t.date)) === viewMonth);
    const prev = transactions.filter((t) => monthKey(new Date(t.date)) === prevKey);
    const curTotal = cur.reduce((s, t) => s + t.amount, 0);
    const prevTotal = prev.reduce((s, t) => s + t.amount, 0);

    const out = [];
    // 1. Perbandingan total
    if (prevTotal > 0) {
      const pct = Math.round(((curTotal - prevTotal) / prevTotal) * 100);
      if (pct !== 0) {
        const up = pct > 0;
        out.push({ cls: up ? "warn" : "good", icon: up ? "⚠" : "✅",
          msg: `Belanja bulan ini ${up ? "naik" : "turun"} ${Math.abs(pct)}% berbanding ${monthName(prevKey)}.` });
      }
    }
    // 2. Kategori paling bergerak
    const byCat = (arr) => { const o = {}; arr.forEach((t) => { o[t.category] = (o[t.category] || 0) + t.amount; }); return o; };
    const cCur = byCat(cur), cPrev = byCat(prev);
    let topMove = null;
    Object.keys(cCur).forEach((cat) => {
      const pc = cPrev[cat] || 0;
      if (pc > 0) {
        const pct = Math.round(((cCur[cat] - pc) / pc) * 100);
        if (pct >= 20 && (!topMove || Math.abs(pct) > Math.abs(topMove.pct))) topMove = { cat, pct };
      }
    });
    if (topMove) {
      out.push({ cls: "warn", icon: "📈",
        msg: `${topMove.cat} meningkat ${topMove.pct}% berbanding ${monthName(prevKey)}.` });
    }
    // 3. Kosong
    if (!cur.length) out.push({ cls: "good", icon: "💡", msg: "Tiada perbelanjaan untuk " + monthName(viewMonth) + " lagi." });

    if (!out.length) {
      wrap.innerHTML = `<div class="insight good">✅ Belanja stabil berbanding bulan lepas.</div>`;
      return;
    }
    wrap.innerHTML = out.map((o) => `<div class="insight ${o.cls}">${o.icon} ${escapeHtml(o.msg)}</div>`).join("");
  }

  function renderBudget() {
    const mTotal = transactions.filter((t) => monthKey(new Date(t.date)) === viewMonth).reduce((s, t) => s + t.amount, 0);
    const b = Number(budgets[viewMonth] || 0);
    if (document.activeElement !== els.budgetInput) els.budgetInput.value = b > 0 ? b : "";
    els.budgetMonth.textContent = monthName(viewMonth);

    if (!(b > 0)) {
      els.budgetFig.textContent = "Tiada bajet ditetapkan";
      els.budgetFill.style.width = "0%";
      els.budgetMsg.textContent = "Tetapkan bajet bulanan untuk jejak baki.";
      return;
    }
    const pct = Math.min(100, (mTotal / b) * 100);
    els.budgetFill.style.width = pct + "%";
    els.budgetFig.textContent = fmtRM(mTotal) + " / " + fmtRM(b);
    if (mTotal > b) {
      els.budgetMsg.textContent = "⚠ Melebihi bajet sebanyak " + fmtRM(mTotal - b);
      els.budgetMsg.className = "budget-msg over";
    } else {
      els.budgetMsg.textContent = "Tinggal " + fmtRM(b - mTotal) + " daripada bajet.";
      els.budgetMsg.className = "budget-msg";
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ============================================================
  // ACTIONS — tulis ke localStorage DULU (selamat), THEN sync cloud
  // ============================================================
  async function addTransaction(e) {
    e.preventDefault();
    const amount = parseFloat(els.amount.value);
    const category = els.category.value;
    const date = els.date.value;
    const note = els.note.value.trim();
    const type = (document.querySelector('input[name="txType"]:checked') || {}).value || "exp";

    if (!(amount > 0)) return showSnack("Sila masukkan jumlah sah.", false);

    const tx = {
      id: genId(),
      amount: Math.round(amount * 100) / 100,
      category,
      date,
      note,
      type,
      receipt: pendingReceipt, // Phase 7: base64 receipt image (may be null)
      createdAt: Date.now(),
    };
    transactions.push(tx);
    save();
    viewMonth = monthKey(new Date(date));
    showAll = false;
    els.form.reset();
    els.date.value = todayISO();
    clearPendingReceipt(); // Phase 7: reset receipt after add
    render();
    showSnack("Rekod ditambah (disimpan secara lokal).", true);
    pushToCloud(tx);
  }

  async function deleteTransaction(id) {
    const before = transactions.length;
    transactions = transactions.filter((t) => t.id !== id);
    if (transactions.length !== before) {
      save();
      render();
      showSnack("Rekod dipadam.", true);
    }
    deleteFromCloud(id);
  }

  // ============================================================
  // EXPORT / IMPORT
  // ============================================================
  // S1: CSV sebenar (buka kat Excel)
  function exportCsv() {
    if (!transactions.length) return showSnack("Tiada data untuk dieksport.", false);
    const header = ["Tarikh", "Kategori", "Jumlah (RM)", "Nota"];
    const rows = transactions.map((t) => [
      t.date,
      t.category,
      t.amount.toFixed(2),
      (t.note || "").replace(/"/g, '""'),
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${c}"`).join(","))
      .join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }); // BOM utk Excel MS
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `financial-expenses-${todayISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showSnack("CSV dieksport: " + transactions.length + " rekod.", true);
  }

  // Sandaran JSON (gabung ikut ID)
  function exportJson() {
    const payload = {
      app: "financial-expenses-tracker",
      version: 2,
      exportedAt: new Date().toISOString(),
      profile: currentProfile,
      transactions,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `financial-expenses-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showSnack("Sandaran dieksport: " + transactions.length + " rekod.", true);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const incoming = Array.isArray(data) ? data : (data && data.transactions) || [];
        if (!Array.isArray(incoming)) throw new Error("format tak sah");
        const map = new Map(transactions.map((t) => [t.id, t]));
        let added = 0;
        incoming.forEach((t) => {
          if (t && t.id && typeof t.amount === "number" && t.date) {
            if (!map.has(t.id)) { map.set(t.id, t); added++; }
          }
        });
        transactions = [...map.values()];
        if (data && data.profile) {
          currentProfile = String(data.profile).slice(0, 24);
          localStorage.setItem(PROFILE_KEY, currentProfile);
        }
        save();
        render();
        showSnack("Import selesai: " + added + " rekod digabung.", true);
        if (sb()) syncFromCloud();
      } catch (e) {
        showSnack("Gagal import: " + e.message, false);
      }
    };
    reader.readAsText(file);
  }

  // ============================================================
  // PHASE 11 — PROFILE MODAL
  // ============================================================
  function openProfile() {
    const inp = document.getElementById("profileNameInput");
    if (inp) inp.value = currentProfile;
    document.getElementById("profileModal").style.display = "flex";
  }
  function closeProfile() {
    document.getElementById("profileModal").style.display = "none";
  }
  function saveProfile(e) {
    e.preventDefault();
    const inp = document.getElementById("profileNameInput");
    const name = inp && inp.value.trim();
    if (!name) return showSnack("Nama profil diperlukan.", false);
    currentProfile = name.slice(0, 24);
    localStorage.setItem(PROFILE_KEY, currentProfile);
    loadData();
    refreshCategories();
    render();
    closeProfile();
    showSnack("Profil: " + currentProfile, true);
  }

  // ============================================================
  // Phase 7: Real receipt photo (base64 stored on transaction)
  // ============================================================
  let pendingReceipt = null; // base64 of selected receipt image (add form)
  function handleReceiptAttach(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      pendingReceipt = e.target.result; // full data URL
      const prev = document.getElementById("receiptThumb");
      if (prev) { prev.src = pendingReceipt; prev.style.display = "block"; }
      showSnack("Foto resit dilampirkan.", true);
    };
    reader.readAsDataURL(file);
  }
  function clearPendingReceipt() {
    pendingReceipt = null;
    const prev = document.getElementById("receiptThumb");
    if (prev) { prev.src = ""; prev.style.display = "none"; }
  }
  function viewReceipt(id) {
    const t = transactions.find((x) => x.id === id);
    if (!t || !t.receipt) return;
    const img = document.getElementById("receiptViewImg");
    if (img) img.src = t.receipt;
    document.getElementById("receiptViewModal").style.display = "flex";
  }
  function closeReceiptView() {
    document.getElementById("receiptViewModal").style.display = "none";
  }

  // ============================================================
  // PHASE 3 — EDIT TRANSACTION
  // ============================================================
  function openEdit(id) {
    const t = transactions.find((x) => x.id === id);
    if (!t) return;
    document.getElementById("editAmount").value = t.amount;
    document.getElementById("editCategory").innerHTML = getCategories().map((c) => `<option value="${c.name}" ${c.name === t.category ? "selected" : ""}>${c.name}</option>`).join("");
    document.getElementById("editDate").value = t.date;
    document.getElementById("editNote").value = t.note || "";
    const tEl = document.querySelector(`#editModal input[name="editType"][value="${t.type || "exp"}"]`);
    if (tEl) tEl.checked = true;
    document.getElementById("editModal").dataset.id = id;
    document.getElementById("editModal").style.display = "flex";
  }
  function closeEdit() {
    document.getElementById("editModal").style.display = "none";
  }
  async function saveEdit(e) {
    e.preventDefault();
    const id = document.getElementById("editModal").dataset.id;
    const t = transactions.find((x) => x.id === id);
    if (!t) return closeEdit();
    const amount = parseFloat(document.getElementById("editAmount").value);
    if (!(amount > 0)) return showSnack("Sila masukkan jumlah sah.", false);
    t.amount = Math.round(amount * 100) / 100;
    t.category = document.getElementById("editCategory").value;
    t.date = document.getElementById("editDate").value;
    t.note = document.getElementById("editNote").value.trim();
    t.type = (document.querySelector('#editModal input[name="editType"]:checked') || {}).value || "exp";
    save();
    closeEdit();
    render();
    showSnack("Rekod dikemas kini.", true);
    pushToCloud(t);
  }

  // Phase 5: refresh category lists (default + custom)
  function refreshCategories() {
    CATEGORIES = getCategories();
    CAT_MAP = getCatMap();
    els.category.innerHTML = CATEGORIES.map((c) => `<option value="${c.name}">${c.name}</option>`).join("");
  }
  function addCategory() {
    const name = document.getElementById("newCatName").value.trim();
    const color = document.getElementById("newCatColor").value;
    if (!name) return showSnack("Nama kategori kosong.", false);
    let custom = [];
    try { custom = JSON.parse(localStorage.getItem("fet_categories_" + currentProfile) || "[]"); }
    catch (e) { custom = []; }
    if (custom.some((c) => c.name === name) || DEFAULT_CATEGORIES.some((c) => c.name === name)) {
      return showSnack("Kategori '" + name + "' dah wujud.", false);
    }
    custom.push({ name, color });
    localStorage.setItem("fet_categories_" + currentProfile, JSON.stringify(custom));
    document.getElementById("newCatName").value = "";
    refreshCategories();
    renderCatFilter();
    showSnack("Kategori '" + name + "' ditambah.", true);
  }

  // ============================================================
  // INIT
  // ============================================================
  async function init() {
    refreshCategories();
    els.date.value = todayISO();

    loadData();

    // Theme setup
    const savedTheme = localStorage.getItem("fet_theme") || "dark";
    document.documentElement.setAttribute("data-theme", savedTheme);

    els.themeToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("fet_theme", next);
    });

    els.profileChip.addEventListener("click", openProfile);

    document.getElementById("addCatBtn").addEventListener("click", addCategory);

    els.form.addEventListener("submit", addTransaction);
    els.prevMonth.addEventListener("click", () => { showAll = false; const [y, m] = viewMonth.split("-").map(Number); viewMonth = monthKey(new Date(y, m - 2, 1)); render(); });
    els.nextMonth.addEventListener("click", () => { showAll = false; const [y, m] = viewMonth.split("-").map(Number); viewMonth = monthKey(new Date(y, m, 1)); render(); });
    els.allToggle.addEventListener("click", () => { showAll = !showAll; render(); });

    els.budgetInput.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      if (isNaN(val) || val < 0) delete budgets[viewMonth]; else budgets[viewMonth] = val;
      localStorage.setItem(BUDGET_KEY(), JSON.stringify(budgets));
      renderBudget();
    });

    els.exportCsvBtn.addEventListener("click", exportCsv);
    els.exportJsonBtn.addEventListener("click", exportJson);
    els.importBtn.addEventListener("click", () => els.importFile.click());
    const searchInput = document.getElementById("searchInput");
    if (searchInput) searchInput.addEventListener("input", (e) => { searchQ = e.target.value.trim(); render(); });

    const catToggleBtn = document.getElementById("catToggleBtn");
    const catAddPanel = document.getElementById("catAddPanel");
    if (catToggleBtn && catAddPanel) catToggleBtn.addEventListener("click", () => {
      catAddPanel.style.display = catAddPanel.style.display === "none" ? "block" : "none";
    });

    const profileForm = document.getElementById("profileForm");
    if (profileForm) profileForm.addEventListener("submit", saveProfile);

    els.importFile.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importData(f);
      e.target.value = "";
    });

    els.receiptInput.addEventListener("change", (e) => {
      const f = e.target.files[0];
      handleReceiptAttach(f);
      e.target.value = "";
    });

    els.txList.addEventListener("click", (e) => {
      const del = e.target.closest(".tx-del");
      if (del) return deleteTransaction(del.dataset.id);
      const ed = e.target.closest(".tx-edit");
      if (ed) return openEdit(ed.dataset.id);
      const rc = e.target.closest(".tx-receipt");
      if (rc) return viewReceipt(rc.dataset.receipt);
    });

    document.getElementById("editForm").addEventListener("submit", saveEdit);
    document.getElementById("editCancel").addEventListener("click", closeEdit);

    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
