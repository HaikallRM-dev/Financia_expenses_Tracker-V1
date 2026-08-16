(() => {
  "use strict";

  let currentProfile = "User";
  let transactions = [];
  let budgets = {};
  let showAll = false;
  let viewMonth = monthKey(new Date());
  let expenseChart = null;

  const CATEGORIES = [
    { name: "Makanan", color: "#f97316" },
    { name: "Pengangkutan", color: "#3b82f6" },
    { name: "Belanja Rumah", color: "#14b8a6" },
    { name: "Bil & Utiliti", color: "#eab308" },
    { name: "Hiburan", color: "#ec4899" },
    { name: "Kesihatan", color: "#ef4444" },
    { name: "Pendidikan", color: "#8b5cf6" },
    { name: "Lain-lain", color: "#9a9aa5" },
  ];
  const CAT_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.name, c.color]));

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
    const scope = showAll ? transactions : transactions.filter((t) => monthKey(new Date(t.date)) === viewMonth);
    const monthTx = transactions.filter((t) => monthKey(new Date(t.date)) === viewMonth);
    const mTotal = monthTx.reduce((s, t) => s + t.amount, 0);
    const aTotal = transactions.reduce((s, t) => s + t.amount, 0);

    els.monthTotal.textContent = fmtRM(mTotal);
    els.monthCount.textContent = monthTx.length;
    els.monthAvg.textContent = "Purata " + fmtRM(monthTx.length ? mTotal / monthTx.length : 0) + " / transaksi";
    els.monthRange.textContent = monthName(viewMonth);

    els.allTotal.textContent = fmtRM(aTotal);
    els.allCount.textContent = transactions.length + " transaksi direkod";

    const byCat = {};
    scope.forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
    const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const max = entries.length ? entries[0][1] : 0;

    if (!entries.length) {
      els.breakdown.innerHTML = `<div class="bd-empty">Tiada perbelanjaan lagi. Tambah rekod di sebelah kiri.</div>`;
    } else {
      els.breakdown.innerHTML = entries.map(([cat, amt]) => {
        const color = CAT_MAP[cat] || "#9a9aa5";
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
        const ds = new Date(t.date).toLocaleDateString("ms-MY", { day: "numeric", month: "short", year: "numeric" });
        return `<div class="tx">
          <span class="tx-dot" style="background:${color}"></span>
          <div class="tx-main">
            <div class="tx-cat">${escapeHtml(t.category)}</div>
            <div class="tx-note">${t.note ? escapeHtml(t.note) : ds}</div>
          </div>
          <div class="tx-right">
            <span class="tx-amt">${fmtRM(t.amount)}</span>
            <span class="tx-date">${ds}</span>
          </div>
          <button class="tx-del" data-id="${t.id}" title="Padam">✕</button>
        </div>`;
      }).join("");
    }

    els.monthLabel.textContent = showAll ? "Semua" : monthName(viewMonth);
    els.allToggle.classList.toggle("active", showAll);
    renderProfile();
    renderBudget();
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

    if (!(amount > 0)) return showSnack("Sila masukkan jumlah sah.", false);

    const tx = {
      id: genId(),
      amount: Math.round(amount * 100) / 100,
      category,
      date,
      note,
      createdAt: Date.now(),
    };
    transactions.push(tx);
    save();
    viewMonth = monthKey(new Date(date));
    showAll = false;
    els.form.reset();
    els.date.value = todayISO();
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
  // S2: Resit — honest. Foto disimpan sebagai nota, TIADA baca automatik.
  // ============================================================
  function handleReceiptAttach(file) {
    if (!file) return;
    els.note.value = "📸 " + file.name;
    showSnack("Foto dilampirkan sebagai nota (tiada pembacaan automatik).", true);
  }

  // ============================================================
  // INIT
  // ============================================================
  async function init() {
    els.category.innerHTML = CATEGORIES.map((c) => `<option value="${c.name}">${c.name}</option>`).join("");
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

    els.profileChip.addEventListener("click", () => {
      const name = prompt("Masukkan nama profil / ahli keluarga:", currentProfile);
      if (name && name.trim()) {
        currentProfile = name.trim().slice(0, 24);
        localStorage.setItem(PROFILE_KEY, currentProfile);
        loadData();
        render();
      }
    });

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
    els.importBtn.addEventListener("click", () => els.importFile.click());
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
      const btn = e.target.closest(".tx-del");
      if (btn) deleteTransaction(btn.dataset.id);
    });

    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
