// ── Auth Middleware ───────────────────────────────────────────────────────
// Protects routes — redirects unauthenticated users to /auth/login
// After login the server stores user info in req.session.user

module.exports = function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    req.user = req.session.user;   // { uid, name, email, role, language }
    return next();
  }
  // Store intended destination so we can redirect after login
  req.session.returnTo = req.originalUrl;
  res.redirect('/auth/login');
};

// Role guard factory — use as requireRole('doctor') or requireRole('patient','anm')
module.exports.requireRole = function(...roles) {
  return function(req, res, next) {
    if (!req.session?.user) return res.redirect('/auth/login');
    if (roles.includes(req.session.user.role)) {
      req.user = req.session.user;
      return next();
    }
    res.status(403).render('index', {
      title: 'Access Denied',
      stats: { totalPatients: 0, pendingReview: 0, redFlags: 0 },
      error: `This page is only for: ${roles.join(', ')}`
    });
  };
};
