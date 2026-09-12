const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const methodOverride = require('method-override');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
require('dotenv').config();

// ── Firebase Admin init (must be before routes) ───────────────────────────
require('./config/firebase');

// ── MongoDB init (for Patient & Document models) ──────────────────────────
const mongoose = require('mongoose');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/casecare_db';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('🍃 MongoDB connected successfully'))
  .catch(err => console.error('❌ MongoDB connection error:', err.message));

const app = express();
const PORT = process.env.PORT || 3000;

// ── Core Middleware ────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ── Session ────────────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'swasthyasetu-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,          // set true in production with HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000  // 24 hours
  }
}));

// ── Make user available in all EJS templates ───────────────────────────────
app.use((req, res, next) => {
  res.locals.user = req.session?.user || null;
  next();
});

// ── EJS + Layouts ──────────────────────────────────────────────────────────
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layouts/main');

// Auth pages use no layout (standalone HTML pages)
app.use((req, res, next) => {
  if (req.path.startsWith('/auth/login') || req.path.startsWith('/auth/register')) {
    res.set('layout', false);
  }
  next();
});

// ── Routes ─────────────────────────────────────────────────────────────────
const indexRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');
const patientRoutes = require('./routes/patients');
const documentRoutes = require('./routes/documents');
const dashboardRoutes = require('./routes/dashboard');
const reportRoutes = require('./routes/reports');
const appointmentRoutes = require('./routes/appointments');
const apiRoutes = require('./routes/api');

app.use('/', indexRoutes);
app.use('/auth', authRoutes);
app.use('/patients', patientRoutes);
app.use('/documents', documentRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/reports', reportRoutes);
app.use('/appointments', appointmentRoutes);
app.use('/api', apiRoutes);

// ── 404 ────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('index', {
    title: 'Page Not Found',
    stats: { totalPatients: 0, pendingReview: 0, redFlags: 0 }
  });
});

// ── Global Error Handler ───────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server Error:', err.stack);
  // Return JSON for API routes, HTML for page routes
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(500).json({ error: err.message });
  }
  res.status(500).send(`
    <div style="font-family:sans-serif;padding:2rem;max-width:600px;margin:auto">
      <h2>❌ Something went wrong</h2>
      <pre style="background:#f8f9fa;padding:1rem;border-radius:8px;font-size:.85rem">${err.message}</pre>
      <a href="/">← Go Home</a>
    </div>`);
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║     🏥 SWASTHYASETU — AI Health Platform             ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  🚀 http://localhost:${PORT}                              ║`);
  console.log('║                                                      ║');
  console.log('║  🔐 Auth:         /auth/login · /auth/register       ║');
  console.log('║  🤒 Case Taking:  /patients                          ║');
  console.log('║  📁 My Reports:   /reports                           ║');
  console.log('║  📅 Appointments: /appointments/new                  ║');
  console.log('║  👨‍⚕️ Dashboard:   /dashboard                         ║');
  console.log('╚══════════════════════════════════════════════════════╝');
});

module.exports = app;