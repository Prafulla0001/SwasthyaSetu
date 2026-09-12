const express  = require('express');
const router   = express.Router();
const { getAuth } = require('firebase-admin/auth');
const { db }   = require('../config/firebase');

// ── GET /auth/login ────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/');
  res.render('auth/login', { title: 'Login — SwasthyaSetu', error: null });
});

// ── GET /auth/register ────────────────────────────────────────────────────
router.get('/register', (req, res) => {
  if (req.session?.user) return res.redirect('/');
  res.render('auth/register', { title: 'Register — SwasthyaSetu', error: null });
});

// ── POST /auth/session ─────────────────────────────────────────────────────
// Called by the client after Firebase sign-in with the ID token.
// Verifies the token, loads Firestore profile, creates session.
router.post('/session', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'No token provided' });

    // Verify Firebase ID token
    const decoded = await getAuth().verifyIdToken(idToken);
    const uid     = decoded.uid;

    // Load or create user profile in Firestore
    const userRef  = db.collection('users').doc(uid);
    const userSnap = await userRef.get();

    let userProfile;
    if (userSnap.exists) {
      userProfile = userSnap.data();
    } else {
      // New user — create basic profile (role chosen at register)
      userProfile = {
        uid,
        email:    decoded.email || '',
        name:     decoded.name  || decoded.email?.split('@')[0] || 'User',
        role:     'patient',
        language: 'English',
        createdAt: new Date().toISOString()
      };
      await userRef.set(userProfile);
    }

    // Store in session
    req.session.user = {
      uid:      uid,
      name:     userProfile.name,
      email:    userProfile.email,
      role:     userProfile.role,
      language: userProfile.language || 'English',
      photoURL: decoded.picture || null,
    };

    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;

    res.json({ success: true, role: userProfile.role, redirect: returnTo });

  } catch (err) {
    console.error('Session creation error:', err.message);
    res.status(401).json({ error: 'Authentication failed: ' + err.message });
  }
});

// ── POST /auth/register-profile ───────────────────────────────────────────
// Called after Firebase creates the account — saves extended profile info.
router.post('/register-profile', async (req, res) => {
  try {
    const { idToken, name, role, phone, language } = req.body;
    if (!idToken) return res.status(400).json({ error: 'No token' });

    const decoded = await getAuth().verifyIdToken(idToken);
    const uid     = decoded.uid;

    const profile = {
      uid,
      email:    decoded.email || '',
      name:     name || decoded.name || '',
      role:     role || 'patient',
      phone:    phone || '',
      language: language || 'English',
      createdAt: new Date().toISOString()
    };

    await db.collection('users').doc(uid).set(profile, { merge: true });

    // Also update Firebase Auth display name
    await getAuth().updateUser(uid, { displayName: name });

    req.session.user = { uid, name: profile.name, email: profile.email, role: profile.role, language: profile.language };

    res.json({ success: true, role: profile.role });

  } catch (err) {
    console.error('Register profile error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /auth/logout ──────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/auth/login');
  });
});

module.exports = router;
