const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const crypto = require('crypto');

// Prevent re-initializing on every warm invocation
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();
const app = express();

app.use(cors());
app.use(express.json());

function cleanString(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return cleanString(value).toLowerCase();
}

function makeTeacherTempPassword() {
  return `Isla-${crypto.randomBytes(4).toString('hex')}!`;
}

function makeStudentTempPassword() {
  return String(crypto.randomInt(100000, 1000000));
}

function firebaseErrorMessage(error) {
  const messages = {
    'auth/email-already-exists': 'That email is already in use.',
    'auth/invalid-email': 'That email address is invalid.',
    'auth/invalid-password': 'The generated password did not meet Firebase requirements.',
    'auth/user-not-found': 'User was not found.',
  };

  return messages[error.code] || error.message || 'Firebase Admin SDK request failed.';
}

async function assertEmailAvailable(email) {
  try {
    await admin.auth().getUserByEmail(email);
    const error = new Error('An account with this email already exists.');
    error.status = 409;
    throw error;
  } catch (error) {
    if (error.code === 'auth/user-not-found') return;
    throw error;
  }
}

async function createUserProfileAndAuditLog(uid, profileData, auditData) {
  const batch = db.batch();
  const userRef = db.collection('users').doc(uid);
  const auditRef = db.collection('auditLogs').doc();
  const createdAt = admin.firestore.FieldValue.serverTimestamp();

  batch.set(userRef, {
    ...profileData,
    createdAt,
  });
  batch.set(auditRef, {
    ...auditData,
    createdAt,
  });

  await batch.commit();
}

async function requireStaff(req, res, next) {
  try {
    const authorization = req.headers.authorization || '';
    const match = authorization.match(/^Bearer (.+)$/);

    if (!match) {
      return res.status(401).json({ error: 'Missing admin bearer token.' });
    }

    const decoded = await admin.auth().verifyIdToken(match[1]);
    if (!['admin', 'teacher'].includes(decoded.role)) {
      return res.status(403).json({ error: 'Admin or teacher access is required.' });
    }

    req.adminUser = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired admin token.' });
  }
}

function sendRouteError(res, error) {
  const status = error.status || (error.code && error.code.startsWith('auth/') ? 400 : 500);
  res.status(status).json({ error: firebaseErrorMessage(error) });
}

// Fetches the Firestore profiles and all Auth users in just 2 calls total,
// instead of looping admin.auth().getUser() once per account (that was the
// slowdown when switching to the Student/Teacher Accounts tabs).
async function listAccounts(role) {
  let query = db.collection('users');
  if (role) {
    query = query.where('role', '==', role);
  }

  const [snapshot, authUsers] = await Promise.all([
    query.get(),
    admin.auth().listUsers(1000),
  ]);

  const authByUid = new Map(authUsers.users.map((user) => [user.uid, user]));

  const accounts = snapshot.docs.map((doc) => {
    const profile = doc.data();
    const authUser = authByUid.get(doc.id);

    return {
      uid: doc.id,
      role: profile.role,
      name: profile.name || authUser?.displayName || '',
      email: profile.email || authUser?.email || '',
      disabled: Boolean(authUser?.disabled),
      createdAt: profile.createdAt?.toDate?.()?.toISOString?.() || null,
    };
  });

  return accounts.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function countCompletedQuests(value) {
  if (!value || typeof value !== 'object') return 0;

  return Object.values(value).reduce((total, item) => {
    if (item === true) return total + 1;
    if (Array.isArray(item)) return total + item.filter(Boolean).length;
    if (item && typeof item === 'object') return total + countCompletedQuests(item);
    return total;
  }, 0);
}

function createSubjectTotals() {
  const topics = ['addition', 'subtraction', 'multiplication', 'division', 'fractions', 'geometry'];
  const difficulties = ['easy', 'medium', 'hard'];
  const totals = {};

  topics.forEach((topic) => {
    difficulties.forEach((difficulty) => {
      totals[`${topic}_${difficulty}`] = {
        key: `${topic}_${difficulty}`,
        topic,
        difficulty,
        correct: 0,
        hints: 0,
        time: 0,
        timeouts: 0,
        total: 0,
      };
    });
  });

  return totals;
}

function normalizeSaveRecord(uid, saveData, profile = {}) {
  const subjectRecords = saveData.subject_records || {};
  const subjectTotals = createSubjectTotals();

  Object.entries(subjectRecords).forEach(([key, record]) => {
    if (!record || typeof record !== 'object') return;
    const parts = key.split('_');
    const topic = parts.slice(0, -1).join('_') || key;
    const difficulty = parts[parts.length - 1] || '';
    const current = subjectTotals[key] || {
      key,
      topic,
      difficulty,
      correct: 0,
      hints: 0,
      time: 0,
      timeouts: 0,
      total: 0,
    };

    current.correct += numberValue(record.correct);
    current.hints += numberValue(record.hints);
    current.time += numberValue(record.time);
    current.timeouts += numberValue(record.timeouts);
    current.total += numberValue(record.total);
    subjectTotals[key] = current;
  });

  const subjects = Object.values(subjectTotals);
  const subjectSummary = subjects.reduce((total, record) => ({
    correct: total.correct + record.correct,
    hints: total.hints + record.hints,
    time: total.time + record.time,
    timeouts: total.timeouts + record.timeouts,
    total: total.total + record.total,
  }), { correct: 0, hints: 0, time: 0, timeouts: 0, total: 0 });

  return {
    uid,
    name: profile.name || profile.displayName || saveData.name || uid,
    email: profile.email || saveData.email || '',
    currentIsland: saveData.current_island || '',
    battleFile: saveData.battle_file || '',
    lastScene: saveData.last_scene || '',
    algemonDefeated: Boolean(saveData.algemon_defeated),
    algemonDefeatedCount: numberValue(saveData.algemon_defeated_count),
    completedQuestCount: countCompletedQuests(saveData.completed_quests),
    islandCorrectAnswers: numberValue(saveData.island_correct_answers),
    islandHintsUsed: numberValue(saveData.island_hints_used),
    islandStars: numberValue(saveData.island_stars),
    islandTimeTaken: numberValue(saveData.island_time_taken || saveData.island_time),
    islandTimeouts: numberValue(saveData.island_timeouts),
    islandTotalQuestions: numberValue(saveData.island_total_questions),
    totalPlaytimeSeconds: numberValue(saveData.total_playtime_seconds),
    subjectSummary,
    subjects,
  };
}

async function buildAnalytics() {
  const [savesSnapshot, usersSnapshot] = await Promise.all([
    db.collection('saves').get(),
    db.collection('users').where('role', '==', 'student').get(),
  ]);

  const profiles = new Map(usersSnapshot.docs.map((doc) => [doc.id, doc.data()]));
  const subjectTotals = createSubjectTotals();
  const totals = {
    students: savesSnapshot.size,
    correct: 0,
    totalAnswered: 0,
    hints: 0,
    timeouts: 0,
    timeTaken: 0,
    stars: 0,
    questProgress: 0,
    islandsCompleted: 0,
    islandTotalQuestions: 0,
    totalPlaytimeSeconds: 0,
  };

  const students = savesSnapshot.docs.map((doc) => {
    const student = normalizeSaveRecord(doc.id, doc.data(), profiles.get(doc.id));

    totals.correct += student.subjectSummary.correct;
    totals.totalAnswered += student.subjectSummary.total;
    totals.hints += student.subjectSummary.hints;
    totals.timeouts += student.subjectSummary.timeouts;
    totals.timeTaken += student.subjectSummary.time || student.islandTimeTaken;
    totals.stars += student.islandStars;
    totals.questProgress += student.completedQuestCount;
    totals.islandsCompleted += student.algemonDefeated ? 1 : 0;
    totals.islandTotalQuestions += student.islandTotalQuestions;
    totals.totalPlaytimeSeconds += student.totalPlaytimeSeconds;

    student.subjects.forEach((record) => {
      const total = subjectTotals[record.key] || record;
      total.correct += record.correct;
      total.hints += record.hints;
      total.time += record.time;
      total.timeouts += record.timeouts;
      total.total += record.total;
      subjectTotals[record.key] = total;
    });

    return student;
  }).sort((a, b) => String(a.name).localeCompare(String(b.name)));

  totals.accuracy = totals.totalAnswered ? totals.correct / totals.totalAnswered : 0;

  return {
    totals,
    students,
    subjectTotals: Object.values(subjectTotals),
  };
}

app.get('/api/admin/accounts', requireStaff, async (req, res) => {
  try {
    const role = cleanString(req.query.role);

    if (role && !['teacher', 'student'].includes(role)) {
      return res.status(400).json({ error: 'Role filter must be teacher or student.' });
    }

    res.json(await listAccounts(role));
  } catch (error) {
    sendRouteError(res, error);
  }
});

app.get('/api/admin/analytics', requireStaff, async (req, res) => {
  try {
    res.json(await buildAnalytics());
  } catch (error) {
    sendRouteError(res, error);
  }
});

app.post('/api/admin/create-teacher', requireStaff, async (req, res) => {
  let createdUid = null;

  try {
    const fullName = cleanString(req.body.fullName || req.body.name);
    const email = normalizeEmail(req.body.email);

    if (!fullName) return res.status(400).json({ error: 'Full name is required.' });
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    await assertEmailAvailable(email);

    const tempPassword = makeTeacherTempPassword();
    const user = await admin.auth().createUser({
      email,
      password: tempPassword,
      displayName: fullName,
    });
    createdUid = user.uid;

    await admin.auth().setCustomUserClaims(user.uid, { role: 'teacher' });
    await createUserProfileAndAuditLog(
      user.uid,
      {
        role: 'teacher',
        name: fullName,
        email,
        createdBy: req.adminUser.uid,
      },
      {
        actorUid: req.adminUser.uid,
        action: 'create_teacher_account',
        targetUid: user.uid,
        targetRole: 'teacher',
      }
    );

    res.status(201).json({
      uid: user.uid,
      email,
      tempPassword,
      message: 'Teacher account created. Share this temporary password now; it is not stored.',
    });
  } catch (error) {
    if (createdUid && !res.headersSent) {
      await admin.auth().deleteUser(createdUid).catch(() => {});
    }
    sendRouteError(res, error);
  }
});

app.post('/api/admin/create-student', requireStaff, async (req, res) => {
  let createdUid = null;

  try {
    const fullName = cleanString(req.body.fullName || req.body.name);
    const email = normalizeEmail(req.body.email);

    if (!fullName) return res.status(400).json({ error: 'Full name is required.' });
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    await assertEmailAvailable(email);

    const tempPassword = makeStudentTempPassword();
    const user = await admin.auth().createUser({
      email,
      password: tempPassword,
      displayName: fullName,
    });
    createdUid = user.uid;

    await admin.auth().setCustomUserClaims(user.uid, { role: 'student' });
    await createUserProfileAndAuditLog(
      user.uid,
      {
        role: 'student',
        name: fullName,
        email,
        createdBy: req.adminUser.uid,
      },
      {
        actorUid: req.adminUser.uid,
        action: 'create_student_account',
        targetUid: user.uid,
        targetRole: 'student',
      }
    );

    res.status(201).json({
      uid: user.uid,
      email,
      tempPassword,
      message: 'Student account created. Share this temporary password now; it is not stored.',
    });
  } catch (error) {
    if (createdUid && !res.headersSent) {
      await admin.auth().deleteUser(createdUid).catch(() => {});
    }
    sendRouteError(res, error);
  }
});

app.post('/api/admin/update-password', requireStaff, async (req, res) => {
  try {
    const uid = cleanString(req.body.uid);
    const password = String(req.body.password || '');

    if (!uid) return res.status(400).json({ error: 'User ID is required.' });
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const targetUser = await admin.auth().updateUser(uid, { password });

    await db.collection('auditLogs').add({
      actorUid: req.adminUser.uid,
      action: 'update_account_password',
      targetUid: uid,
      targetEmail: targetUser.email || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      uid,
      email: targetUser.email || '',
      message: 'Password updated.',
    });
  } catch (error) {
    sendRouteError(res, error);
  }
});

app.use((req, res) => {
  console.log('Unmatched route:', req.method, req.url);
  res.status(404).json({ error: 'Route not found' });
});

// No app.listen() here — Vercel invokes this as a serverless function.
module.exports = app;