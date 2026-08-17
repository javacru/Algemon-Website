import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBbP0SASK6yOX3zr0msoD7zui-mLcC8IGs",
  authDomain: "algemon-1c2bb.firebaseapp.com",
  databaseURL: "https://algemon-1c2bb-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "algemon-1c2bb",
  storageBucket: "algemon-1c2bb.firebasestorage.app",
  messagingSenderId: "500909177229",
  appId: "1:500909177229:web:c8dcc6bb556608e2f825c4",
  measurementId: "G-B59JNSPFMQ"
};

const state = {
  db: null,
  auth: null,
  currentUser: null,
  currentRole: "",
  connected: false,
  authChecked: false,
  view: "dashboard",
  accountView: "",
  topic: "addition",
  difficulty: "easy",
  questions: [],
  accounts: {
    student: {
      items: null,
      error: "",
      promise: null
    },
    teacher: {
      items: null,
      error: "",
      promise: null
    }
  },
  analytics: null,
  charts: {},
  editIndex: -1,
  deleteIndex: -1,
  passwordAccount: null
};

const topicNames = {
  addition: "Addition",
  subtraction: "Subtraction",
  multiplication: "Multiplication",
  division: "Division",
  fractions: "Fractions",
  geometry: "Geometry"
};

const els = {
  homeView: document.getElementById("home-view"),
  loginView: document.getElementById("login-view"),
  adminView: document.getElementById("admin-view"),
  loginForm: document.getElementById("login-form"),
  loginEmail: document.getElementById("login-email"),
  loginPassword: document.getElementById("login-password"),
  loginError: document.getElementById("login-error"),
  loginSubmit: document.getElementById("login-submit"),
  status: document.getElementById("fb-status"),
  banner: document.getElementById("connect-banner"),
  pageTitle: document.getElementById("page-title"),
  tableTitle: document.getElementById("table-title"),
  docName: document.getElementById("doc-name"),
  count: document.getElementById("question-count"),
  table: document.getElementById("table-container"),
  controls: document.querySelector(".controls"),
  tableCard: document.querySelector(".table-card"),
  topbarActions: document.querySelector(".topbar-actions"),
  search: document.getElementById("search-input"),
  difficulty: document.getElementById("difficulty-select"),
  addBtn: document.getElementById("add-btn"),
  refreshBtn: document.getElementById("refresh-btn"),
  logoutBtn: document.getElementById("logout-btn"),
  questionModal: document.getElementById("question-modal"),
  questionForm: document.getElementById("question-form"),
  modalTitle: document.getElementById("modal-title"),
  questionInput: document.getElementById("q-question"),
  hintInput: document.getElementById("q-hint"),
  deleteModal: document.getElementById("delete-modal"),
  deletePreview: document.getElementById("delete-preview"),
  passwordModal: document.getElementById("password-modal"),
  passwordForm: document.getElementById("password-form"),
  passwordPreview: document.getElementById("password-account-preview"),
  newPassword: document.getElementById("account-new-password"),
  confirmPassword: document.getElementById("account-confirm-password"),
  toasts: document.getElementById("toasts")
};

const API_BASE = "http://localhost:3001";
const STAFF_ROLES = new Set(["admin", "teacher"]);

function showView(name) {
  els.homeView.classList.toggle("active", name === "home");
  els.loginView.classList.toggle("active", name === "login");
  els.adminView.classList.toggle("active", name === "admin");
}

function routeFromHash() {
  const hash = window.location.hash || "#home";
  if (hash === "#login") return "login";
  if (hash === "#admin" || hash.startsWith("#admin/")) return "admin";
  return "home";
}

function setLoginError(message = "") {
  els.loginError.textContent = message;
  els.loginError.hidden = !message;
}

function redirectToLogin() {
  showView("login");
  if (window.location.hash !== "#login") {
    window.location.hash = "login";
  }
}

async function hasStaffAccess(user) {
  if (!user) return false;

  const tokenResult = await user.getIdTokenResult(true);
  const role = tokenResult.claims.role || (tokenResult.claims.admin ? "admin" : "");
  state.currentRole = role;
  return STAFF_ROLES.has(role);
}

async function ensureAdminView() {
  if (!state.authChecked) return;

  if (!state.currentUser) {
    redirectToLogin();
    return;
  }

  showView("admin");
  if (window.location.hash !== "#admin") {
    window.location.hash = "admin";
  }

  if (state.connected) {
    await renderCurrentView();
  }
}

async function handleRoute() {
  const route = routeFromHash();

  if (route === "admin") {
    await ensureAdminView();
    return;
  }

  if (route === "login") {
    if (state.currentUser && state.authChecked) {
      await ensureAdminView();
      return;
    }

    showView("login");
    return;
  }

  showView("home");
}

function docId() {
  return `${state.difficulty}_${state.topic}`;
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function clean(value) {
  return String(value || "").replace(/[&<>"]/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" };
    return map[char];
  });
}

function updateHeading() {
  const topic = topicNames[state.topic];
  const difficulty = titleCase(state.difficulty);
  els.pageTitle.textContent = `${topic} Questions`;
  els.tableTitle.textContent = `${difficulty} ${topic}`;
  els.docName.textContent = `Document: ${docId()}`;
}

function setStatus(text, type) {
  if (!els.status) return;
  els.status.textContent = text;
  els.status.className = type;
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  els.toasts.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

async function startFirebase() {
  try {
    const app = initializeApp(FIREBASE_CONFIG);
    state.auth = getAuth(app);
    state.db = getFirestore(app);
    state.connected = true;
    setStatus("Connected", "success");
    onAuthStateChanged(state.auth, async (user) => {
      try {
        state.authChecked = false;
        if (user && await hasStaffAccess(user)) {
          state.currentUser = user;
          sessionStorage.setItem("islaAdminToken", await user.getIdToken());
          els.banner.hidden = true;
          preloadAccounts();
        } else {
          if (user) {
            await signOut(state.auth);
            setLoginError("This account does not have admin or teacher access.");
          }
          state.currentUser = null;
          state.currentRole = "";
          sessionStorage.removeItem("islaAdminToken");
        }
      } catch (error) {
        state.currentUser = null;
        state.currentRole = "";
        sessionStorage.removeItem("islaAdminToken");
        setLoginError("Unable to verify this account. Please sign in again.");
      } finally {
        state.authChecked = true;
        await handleRoute();
      }
    });
  } catch (error) {
    setStatus("Failed", "error");
    showToast("Firebase connection failed.", "error");
    console.error(error);
  }
}

async function login(event) {
  event.preventDefault();
  setLoginError("");
  els.loginSubmit.disabled = true;
  els.loginSubmit.textContent = "Signing in...";

  try {
    const credential = await signInWithEmailAndPassword(
      state.auth,
      els.loginEmail.value.trim(),
      els.loginPassword.value
    );

    if (!await hasStaffAccess(credential.user)) {
      await signOut(state.auth);
      setLoginError("This account does not have admin or teacher access.");
      return;
    }

    window.location.hash = "admin";
  } catch (error) {
    setLoginError("Invalid email or password.");
  } finally {
    els.loginSubmit.disabled = false;
    els.loginSubmit.textContent = "Login";
  }
}

async function logout() {
  await signOut(state.auth);
  sessionStorage.removeItem("islaAdminToken");
  state.currentUser = null;
  state.currentRole = "";
  window.location.hash = "login";
  showToast("Signed out.", "success");
}

async function renderCurrentView() {
  if (state.view === "dashboard") {
    await renderDashboard();
    return;
  }

  if (state.view === "analytics") {
    await renderAnalytics();
    return;
  }

  if (state.view === "teacher-accounts") {
    await renderTeacherAccounts();
    return;
  }

  if (state.view === "student-accounts") {
    await renderStudentAccounts();
    return;
  }

  await loadQuestions();
}

async function renderDashboard() {
  state.view = "dashboard";
  els.controls.hidden = true;
  els.topbarActions.hidden = true;
  els.addBtn.hidden = false;
  els.pageTitle.textContent = "Dashboard";
  els.tableTitle.textContent = "Accounts";
  els.docName.textContent = "Student and teacher accounts";
  els.table.innerHTML = '<div class="empty-state">Loading accounts...</div>';

  const [students, teachers] = await Promise.allSettled([
    loadAccounts("student"),
    loadAccounts("teacher")
  ]);

  const studentContent = students.status === "fulfilled"
    ? renderAccountsList(students.value, "student")
    : `<div class="notice inline-notice">${clean(students.reason.message)}</div>`;
  const teacherContent = teachers.status === "fulfilled"
    ? renderAccountsList(teachers.value, "teacher")
    : `<div class="notice inline-notice">${clean(teachers.reason.message)}</div>`;

  els.table.innerHTML = `
    <div class="accounts-dashboard">
      ${studentContent}
      ${teacherContent}
    </div>
  `;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatPercent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function prettyMetricKey(value) {
  return String(value || "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function metricCard(label, value, note = "") {
  return `
    <div class="analytics-card">
      <span>${clean(label)}</span>
      <strong>${clean(value)}</strong>
      ${note ? `<p>${clean(note)}</p>` : ""}
    </div>
  `;
}

function barRow(label, value, max, detail = "") {
  const safeMax = Math.max(Number(max) || 0, 1);
  const width = Math.max(0, Math.min(100, (Number(value) || 0) / safeMax * 100));

  return `
    <div class="bar-row">
      <div class="bar-label">
        <span>${clean(label)}</span>
        <strong>${clean(detail || formatNumber(value))}</strong>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width: ${width}%"></div>
      </div>
    </div>
  `;
}

const CHART_COLORS = ["#2563eb", "#14b8a6", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2"];

function upsertChart(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (state.charts[canvasId]) {
    state.charts[canvasId].destroy();
  }

  state.charts[canvasId] = new Chart(canvas, config);
}

function subjectTotalsByTopic(subjects) {
  const byTopic = new Map();

  subjects.forEach((record) => {
    const current = byTopic.get(record.topic) || { correct: 0, total: 0 };
    current.correct += Number(record.correct) || 0;
    current.total += Number(record.total) || 0;
    byTopic.set(record.topic, current);
  });

  return Array.from(byTopic.entries()).map(([topic, values]) => ({
    topic,
    label: topicNames[topic] || prettyMetricKey(topic),
    ...values
  }));
}

function selectedAnalyticsStudent() {
  const select = document.getElementById("analytics-student-select");
  const uid = select?.value || "all";
  return uid === "all" ? null : state.analytics?.students.find((student) => student.uid === uid);
}

function analyticsScopeData() {
  const selected = selectedAnalyticsStudent();

  if (!selected) {
    return {
      label: "All Students",
      totals: state.analytics.totals,
      subjects: state.analytics.subjectTotals,
      student: null
    };
  }

  return {
    label: selected.name,
    totals: {
      students: 1,
      correct: selected.subjectSummary.correct,
      totalAnswered: selected.subjectSummary.total,
      hints: selected.subjectSummary.hints,
      timeouts: selected.subjectSummary.timeouts,
      timeTaken: selected.subjectSummary.time || selected.islandTimeTaken,
      stars: selected.islandStars,
      questProgress: selected.completedQuestCount,
      islandsCompleted: selected.algemonDefeated ? 1 : 0,
      islandTotalQuestions: selected.islandTotalQuestions,
      totalPlaytimeSeconds: selected.totalPlaytimeSeconds,
      accuracy: selected.subjectSummary.total ? selected.subjectSummary.correct / selected.subjectSummary.total : 0
    },
    subjects: selected.subjects,
    student: selected
  };
}

function renderAnalyticsBody() {
  const scope = analyticsScopeData();
  const totals = scope.totals;
  const maxSubject = Math.max(...scope.subjects.map((record) => record.total), 1);
  const studentOptions = state.analytics.students.map((student) => `
    <option value="${clean(student.uid)}">${clean(student.name)}${student.email ? ` (${clean(student.email)})` : ""}</option>
  `).join("");
  const selectedUid = scope.student?.uid || "all";

  els.table.innerHTML = `
    <div class="analytics-panel">
      <div class="analytics-toolbar">
        <label for="analytics-student-select">
          Student
          <select id="analytics-student-select">
            <option value="all">All Students</option>
            ${studentOptions}
          </select>
        </label>
      </div>

      <div class="analytics-grid">
        ${metricCard("Correct Answers", formatNumber(totals.correct), `${formatPercent(totals.accuracy)} accuracy`)}
        ${metricCard("Total Questions Answered", formatNumber(totals.totalAnswered))}
        ${metricCard("Hints Used", formatNumber(totals.hints))}
        ${metricCard("Timeouts", formatNumber(totals.timeouts))}
        ${metricCard("Time Taken", formatDuration(totals.timeTaken), "Subject record time")}
        ${metricCard("Stars", formatNumber(totals.stars))}
        ${metricCard("Quest Progress", formatNumber(totals.questProgress), "Completed quest entries")}
        ${metricCard("Total Playtime", formatDuration(totals.totalPlaytimeSeconds))}
      </div>

      <div class="analytics-columns">
        <section class="analytics-section">
          <div class="subsection-heading">
            <h4>Accuracy</h4>
            <span>${clean(scope.label)}</span>
          </div>
          <div class="chart-wrap chart-wrap-sm">
            <canvas id="accuracy-chart"></canvas>
          </div>
        </section>

        <section class="analytics-section">
          <div class="subsection-heading">
            <h4>Answer Activity</h4>
            <span>${clean(scope.label)}</span>
          </div>
          <div class="chart-wrap chart-wrap-sm">
            <canvas id="answer-activity-chart"></canvas>
          </div>
        </section>
      </div>

      <section class="analytics-section">
        <div class="subsection-heading">
          <h4>Island Status</h4>
          <span>${scope.student ? clean(scope.student.currentIsland || "No island") : `${formatNumber(totals.students)} students`}</span>
        </div>
        ${barRow("Island correct answers", scope.student?.islandCorrectAnswers || 0, Math.max(scope.student?.islandTotalQuestions || totals.islandTotalQuestions, 1))}
        ${barRow("Island total questions", scope.student?.islandTotalQuestions || totals.islandTotalQuestions, Math.max(scope.student?.islandTotalQuestions || totals.islandTotalQuestions, 1))}
        ${barRow("Island hints used", scope.student?.islandHintsUsed || 0, Math.max(scope.student?.islandHintsUsed || 1, 1))}
        ${barRow("Island timeouts", scope.student?.islandTimeouts || 0, Math.max(scope.student?.islandTimeouts || 1, 1))}
        ${barRow("Island completed", totals.islandsCompleted, Math.max(totals.students, 1), `${formatNumber(totals.islandsCompleted)} / ${formatNumber(totals.students)}`)}
      </section>

      <section class="analytics-section">
        <div class="subsection-heading">
          <h4>Subject Records by Topic</h4>
          <span>${clean(scope.label)}</span>
        </div>
        <div class="chart-wrap">
          <canvas id="subject-topic-chart"></canvas>
        </div>
      </section>

      <section class="analytics-section">
        <div class="subsection-heading">
          <h4>Subject Records by Topic and Difficulty</h4>
          <span>${clean(scope.label)}</span>
        </div>
        <div class="subject-record-grid">
          ${scope.subjects.map((record) => `
            <div class="subject-record">
              <div class="bar-label">
                <span>${clean(prettyMetricKey(record.key))}</span>
                <strong>${formatNumber(record.correct)} / ${formatNumber(record.total)}</strong>
              </div>
              <div class="bar-track">
                <div class="bar-fill" style="width: ${Math.max(0, Math.min(100, record.total / maxSubject * 100))}%"></div>
              </div>
              <p>${formatNumber(record.hints)} hints - ${formatNumber(record.timeouts)} timeouts - ${formatDuration(record.time)}</p>
            </div>
          `).join("")}
        </div>
      </section>

      ${scope.student ? `
        <section class="analytics-section">
          <div class="subsection-heading">
            <h4>Selected Student Save</h4>
            <span>${clean(scope.student.email || scope.student.uid)}</span>
          </div>
          <div class="student-save-grid">
            ${metricCard("Current Island", scope.student.currentIsland || "Not recorded")}
            ${metricCard("Battle File", scope.student.battleFile || "Not recorded")}
            ${metricCard("Algemon Defeated", scope.student.algemonDefeated ? "Completed" : "Not completed")}
            ${metricCard("Algemon Defeated Count", formatNumber(scope.student.algemonDefeatedCount))}
          </div>
        </section>
      ` : ""}
    </div>
  `;

  document.getElementById("analytics-student-select").value = selectedUid;

  renderAnalyticsCharts(scope);
}

function renderAnalyticsCharts(scope) {
  const totals = scope.totals;
  const incorrect = Math.max(totals.totalAnswered - totals.correct, 0);

  upsertChart("accuracy-chart", {
    type: "doughnut",
    data: {
      labels: ["Correct", "Incorrect"],
      datasets: [{
        data: [totals.correct, incorrect],
        backgroundColor: [CHART_COLORS[1], "#e5e7eb"],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } }
      }
    }
  });

  upsertChart("answer-activity-chart", {
    type: "bar",
    data: {
      labels: ["Correct", "Answered", "Hints", "Timeouts"],
      datasets: [{
        data: [totals.correct, totals.totalAnswered, totals.hints, totals.timeouts],
        backgroundColor: [CHART_COLORS[0], CHART_COLORS[1], CHART_COLORS[2], CHART_COLORS[3]],
        borderRadius: 6,
        maxBarThickness: 48
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } }
      }
    }
  });

  const topicTotals = subjectTotalsByTopic(scope.subjects);

  upsertChart("subject-topic-chart", {
    type: "bar",
    data: {
      labels: topicTotals.map((record) => record.label),
      datasets: [
        {
          label: "Correct",
          data: topicTotals.map((record) => record.correct),
          backgroundColor: CHART_COLORS[0],
          borderRadius: 6,
          maxBarThickness: 36
        },
        {
          label: "Total Answered",
          data: topicTotals.map((record) => record.total),
          backgroundColor: "#dbeafe",
          borderRadius: 6,
          maxBarThickness: 36
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } }
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } }
      }
    }
  });
}

async function renderAnalytics(force = false) {
  state.view = "analytics";
  els.controls.hidden = true;
  els.topbarActions.hidden = false;
  els.addBtn.hidden = true;
  els.pageTitle.textContent = "Analytics";
  els.tableTitle.textContent = "Learning Analytics";
  els.docName.textContent = "Student saves, subject records, island progress, and playtime";
  els.table.innerHTML = '<div class="empty-state">Loading analytics...</div>';

  try {
    if (!state.analytics || force) {
      state.analytics = await apiRequest("/api/admin/analytics");
    }

    renderAnalyticsBody();
  } catch (error) {
    els.table.innerHTML = `<div class="empty-state">Unable to load analytics: ${clean(error.message)}</div>`;
  }
}

async function loadQuestions() {
  if (!state.connected) return;

  updateHeading();
  els.controls.hidden = false;
  els.topbarActions.hidden = false;
  els.addBtn.hidden = false;
  els.addBtn.textContent = "Add Question";
  els.table.innerHTML = '<div class="empty-state">Loading questions...</div>';

  try {
    const ref = doc(state.db, "questions", docId());
    const snapshot = await getDoc(ref);
    state.questions = snapshot.exists() ? snapshot.data().questions || [] : [];
    renderTable();
  } catch (error) {
    els.table.innerHTML = '<div class="empty-state">Unable to load questions.</div>';
    showToast("Unable to load questions.", "error");
    console.error(error);
  }
}

function getAdminToken() {
  return sessionStorage.getItem("islaAdminToken") || "";
}

async function apiRequest(path, options = {}) {
  const token = getAdminToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

function renderCredentialBox(result) {
  if (!result) return "";

  return `
    <div class="credential-box span-2">
      <span>Login email</span>
      <strong>${clean(result.email)}</strong>
      <span>Temporary password</span>
      <strong>${clean(result.tempPassword)}</strong>
    </div>
  `;
}

function preloadAccounts() {
  ["student", "teacher"].forEach((role) => {
    loadAccounts(role).catch((error) => {
      console.warn(`Unable to preload ${role} accounts.`, error);
    });
  });
}

async function loadAccounts(role, force = false) {
  const cache = state.accounts[role];
  if (!cache) return [];

  if (!force && cache.items) {
    return cache.items;
  }

  if (!force && cache.promise) {
    return cache.promise;
  }

  cache.error = "";
  cache.promise = apiRequest(`/api/admin/accounts?role=${encodeURIComponent(role)}`)
    .then((accounts) => {
      cache.items = accounts;
      return accounts;
    })
    .catch((error) => {
      cache.error = error.message;
      throw error;
    })
    .finally(() => {
      cache.promise = null;
    });

  return cache.promise;
}

function formatStatus(account) {
  return account.disabled ? "Disabled" : "Active";
}

function renderAccountsList(accounts, role) {
  if (!accounts.length) {
    return '<div class="empty-state compact-empty">No accounts yet.</div>';
  }

  const rows = accounts.map((account, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${clean(account.name)}</td>
      <td>${clean(account.email)}</td>
      <td>${formatStatus(account)}</td>
      <td>
        <button class="mini-btn" data-password-uid="${clean(account.uid)}" data-password-name="${clean(account.name || account.email)}" data-password-email="${clean(account.email)}">Change Password</button>
      </td>
    </tr>
  `).join("");

  return `
    <div class="account-list span-2">
      <div class="subsection-heading">
        <h4>${role === "teacher" ? "Teacher Accounts" : "Student Accounts"}</h4>
        <span>${accounts.length} total</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

async function renderTeacherAccounts(result = null) {
  state.view = "teacher-accounts";
  els.controls.hidden = true;
  els.topbarActions.hidden = true;
  els.addBtn.hidden = false;
  els.pageTitle.textContent = "Teacher Accounts";
  els.tableTitle.textContent = "Create Teacher Account";
  els.docName.textContent = "Account Maker";
  els.table.innerHTML = '<div class="empty-state">Loading accounts...</div>';

  let accounts = [];
  let listError = "";

  try {
    accounts = await loadAccounts("teacher");
  } catch (error) {
    listError = error.message;
  }

  els.table.innerHTML = `
    <form class="account-form" id="teacher-account-form">
      <label>
        Full Name
        <input id="teacher-full-name" type="text" autocomplete="name" placeholder="Teacher full name">
      </label>
      <label>
        Email
        <input id="teacher-email" type="email" autocomplete="email" placeholder="teacher@example.com">
      </label>
      ${renderCredentialBox(result)}
      <div class="form-actions span-2">
        <button class="btn btn-primary" type="submit">Create Teacher</button>
      </div>
      ${listError ? `<div class="notice inline-notice span-2">${clean(listError)}</div>` : renderAccountsList(accounts, "teacher")}
    </form>
  `;

  document.getElementById("teacher-account-form").addEventListener("submit", createTeacherAccount);
}

async function renderStudentAccounts(result = null) {
  state.view = "student-accounts";
  els.controls.hidden = true;
  els.topbarActions.hidden = true;
  els.addBtn.hidden = false;
  els.pageTitle.textContent = "Student Accounts";
  els.tableTitle.textContent = "Create Student Account";
  els.docName.textContent = "Account Maker";
  els.table.innerHTML = '<div class="empty-state">Loading accounts...</div>';

  let accounts = [];
  let listError = "";

  try {
    accounts = await loadAccounts("student");
  } catch (error) {
    listError = error.message;
  }

  els.table.innerHTML = `
    <form class="account-form" id="student-account-form">
      <label>
        Full Name
        <input id="student-full-name" type="text" autocomplete="name" placeholder="Student full name">
      </label>
      <label>
        Email
        <input id="student-email" type="email" autocomplete="email" placeholder="student@example.com">
      </label>
      ${renderCredentialBox(result)}
      <div class="form-actions span-2">
        <button class="btn btn-primary" type="submit">Create Student</button>
      </div>
      ${listError ? `<div class="notice inline-notice span-2">${clean(listError)}</div>` : renderAccountsList(accounts, "student")}
    </form>
  `;

  document.getElementById("student-account-form").addEventListener("submit", createStudentAccount);
}

async function createTeacherAccount(event) {
  event.preventDefault();

  try {
    const result = await apiRequest("/api/admin/create-teacher", {
      method: "POST",
      body: JSON.stringify({
        fullName: document.getElementById("teacher-full-name").value.trim(),
        email: document.getElementById("teacher-email").value.trim()
      })
    });

    showToast("Teacher account created.", "success");
    await loadAccounts("teacher", true);
    await renderTeacherAccounts(result);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function createStudentAccount(event) {
  event.preventDefault();

  try {
    const result = await apiRequest("/api/admin/create-student", {
      method: "POST",
      body: JSON.stringify({
        fullName: document.getElementById("student-full-name").value.trim(),
        email: document.getElementById("student-email").value.trim()
      })
    });

    showToast("Student account created.", "success");
    await loadAccounts("student", true);
    await renderStudentAccounts(result);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function filteredQuestions() {
  const keyword = els.search.value.trim().toLowerCase();
  if (!keyword) return state.questions;

  return state.questions.filter((item) => {
    const choices = item.choices || [];
    return (
      (item.question || "").toLowerCase().includes(keyword) ||
      (item.hint || "").toLowerCase().includes(keyword) ||
      choices.some((choice) => String(choice).toLowerCase().includes(keyword))
    );
  });
}

function renderTable() {
  const rows = filteredQuestions();
  els.count.textContent = state.questions.length;

  if (rows.length === 0) {
    els.table.innerHTML = '<div class="empty-state">No questions found.</div>';
    return;
  }

  const tableRows = rows.map((item, index) => {
    const realIndex = state.questions.indexOf(item);
    const choices = item.choices || [];
    const correct = choices[item.correct] || "";

    return `
      <tr>
        <td>${index + 1}</td>
        <td>${clean(item.question)}</td>
        <td>${clean(choices.join(" | "))}</td>
        <td>${clean(correct)}</td>
        <td>${clean(item.hint || "-")}</td>
        <td>
          <button class="mini-btn" data-edit="${realIndex}">Edit</button>
          <button class="mini-btn danger" data-delete="${realIndex}">Delete</button>
        </td>
      </tr>
    `;
  }).join("");

  els.table.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Question</th>
          <th>Choices</th>
          <th>Correct</th>
          <th>Hint</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  `;
}

function openQuestionModal(index = -1) {
  if (!state.connected) {
    showToast("Firebase is not connected yet.", "warning");
    return;
  }

  state.editIndex = index;
  const item = index >= 0 ? state.questions[index] : null;
  els.modalTitle.textContent = index >= 0 ? "Edit Question" : "Add Question";
  els.questionInput.value = item?.question || "";
  els.hintInput.value = item?.hint || "";

  [0, 1, 2].forEach((choiceIndex) => {
    document.getElementById(`choice-${choiceIndex}`).value = item?.choices?.[choiceIndex] || "";
    document.querySelector(`input[name="correct"][value="${choiceIndex}"]`).checked = item?.correct === choiceIndex;
  });

  els.questionModal.classList.add("active");
}

function closeQuestionModal() {
  els.questionModal.classList.remove("active");
  els.questionForm.reset();
  state.editIndex = -1;
}

async function saveQuestion(event) {
  event.preventDefault();

  const selectedAnswer = document.querySelector('input[name="correct"]:checked');
  const question = els.questionInput.value.trim();
  const choices = [0, 1, 2].map((index) => document.getElementById(`choice-${index}`).value.trim());
  const hint = els.hintInput.value.trim();

  if (!question || choices.some((choice) => !choice) || !selectedAnswer) {
    showToast("Complete the question, choices, and correct answer.", "warning");
    return;
  }

  const nextQuestions = [...state.questions];
  const questionData = {
    question,
    choices,
    correct: Number(selectedAnswer.value),
    hint
  };

  if (state.editIndex >= 0) {
    nextQuestions[state.editIndex] = questionData;
  } else {
    nextQuestions.push(questionData);
  }

  try {
    await setDoc(doc(state.db, "questions", docId()), { questions: nextQuestions });
    state.questions = nextQuestions;
    closeQuestionModal();
    renderTable();
    showToast("Question saved.", "success");
  } catch (error) {
    showToast("Question was not saved.", "error");
    console.error(error);
  }
}

function openDeleteModal(index) {
  state.deleteIndex = index;
  els.deletePreview.textContent = state.questions[index]?.question || "";
  els.deleteModal.classList.add("active");
}

function closeDeleteModal() {
  els.deleteModal.classList.remove("active");
  state.deleteIndex = -1;
}

function openPasswordModal(uid, name, email) {
  state.passwordAccount = { uid, name, email };
  els.passwordPreview.textContent = `${name || "Account"} (${email || uid})`;
  els.passwordForm.reset();
  els.passwordModal.classList.add("active");
}

function closePasswordModal() {
  els.passwordModal.classList.remove("active");
  els.passwordForm.reset();
  state.passwordAccount = null;
}

async function updateAccountPassword(event) {
  event.preventDefault();

  const password = els.newPassword.value;
  const confirmPassword = els.confirmPassword.value;

  if (!state.passwordAccount) {
    showToast("Select an account first.", "warning");
    return;
  }

  if (password.length < 6) {
    showToast("Password must be at least 6 characters.", "warning");
    return;
  }

  if (password !== confirmPassword) {
    showToast("Passwords do not match.", "warning");
    return;
  }

  try {
    await apiRequest("/api/admin/update-password", {
      method: "POST",
      body: JSON.stringify({
        uid: state.passwordAccount.uid,
        password
      })
    });

    closePasswordModal();
    showToast("Password updated.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteQuestion() {
  const nextQuestions = state.questions.filter((_, index) => index !== state.deleteIndex);

  try {
    await setDoc(doc(state.db, "questions", docId()), { questions: nextQuestions });
    state.questions = nextQuestions;
    closeDeleteModal();
    renderTable();
    showToast("Question deleted.", "success");
  } catch (error) {
    showToast("Question was not deleted.", "error");
    console.error(error);
  }
}

// Overview buttons
document.querySelectorAll(".overview-btn").forEach((button) => {
  button.addEventListener("click", async () => {
    setActive(button);
    state.view = button.dataset.overview === "analytics" ? "analytics" : "dashboard";
    els.search.value = "";
    await renderCurrentView();
  });
});

// Accounts buttons
document.querySelectorAll(".accounts-btn").forEach((button) => {
  button.addEventListener("click", async () => {
    setActive(button);
    state.view = button.dataset.accounts;
    els.search.value = "";
    await renderCurrentView();
  });
});

// Topic buttons
document.querySelectorAll(".topic-btn").forEach((button) => {
  button.addEventListener("click", async () => {
    setActive(button);
    state.view = "questions";
    state.topic = button.dataset.topic;
    els.search.value = "";
    await renderCurrentView();
  });
});

function setActive(button) {
  document.querySelector(".overview-btn.active, .accounts-btn.active, .topic-btn.active")
    ?.classList.remove("active");
  button.classList.add("active");
}

els.difficulty.addEventListener("change", async () => {
  state.difficulty = els.difficulty.value;
  els.search.value = "";
  await renderCurrentView();
});

els.search.addEventListener("input", renderTable);
els.refreshBtn.addEventListener("click", async () => {
  if (state.view === "analytics") {
    await renderAnalytics(true);
    return;
  }

  await renderCurrentView();
});
els.addBtn.addEventListener("click", () => openQuestionModal());
els.loginForm.addEventListener("submit", login);
els.logoutBtn.addEventListener("click", logout);
els.questionForm.addEventListener("submit", saveQuestion);
document.getElementById("cancel-question").addEventListener("click", closeQuestionModal);
document.getElementById("close-question-modal").addEventListener("click", closeQuestionModal);
document.getElementById("cancel-delete").addEventListener("click", closeDeleteModal);
document.getElementById("close-delete-modal").addEventListener("click", closeDeleteModal);
document.getElementById("confirm-delete").addEventListener("click", deleteQuestion);
els.passwordForm.addEventListener("submit", updateAccountPassword);
document.getElementById("cancel-password").addEventListener("click", closePasswordModal);
document.getElementById("close-password-modal").addEventListener("click", closePasswordModal);

els.table.addEventListener("click", (event) => {
  const editIndex = event.target.dataset.edit;
  const deleteIndex = event.target.dataset.delete;
  const passwordUid = event.target.dataset.passwordUid;

  if (editIndex !== undefined) openQuestionModal(Number(editIndex));
  if (deleteIndex !== undefined) openDeleteModal(Number(deleteIndex));
  if (passwordUid !== undefined) {
    openPasswordModal(
      passwordUid,
      event.target.dataset.passwordName || "",
      event.target.dataset.passwordEmail || ""
    );
  }
});

els.table.addEventListener("change", (event) => {
  if (event.target.id === "analytics-student-select") {
    renderAnalyticsBody();
  }
});

document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      overlay.classList.remove("active");
    }
  });
});

updateHeading();
window.addEventListener("hashchange", handleRoute);
startFirebase();
handleRoute();
