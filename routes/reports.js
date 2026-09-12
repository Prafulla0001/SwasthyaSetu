const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const cloudinary = require('../config/cloudinary');
const { db }     = require('../config/firebase');
const requireAuth = require('../middleware/auth');
const { performOCR } = require('../services/ocrService');

// ── Multer with memory storage (we stream to Cloudinary) ─────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },  // 20 MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf|webp/;
    const ok = allowed.test(file.mimetype) || allowed.test(file.originalname.toLowerCase());
    ok ? cb(null, true) : cb(new Error('Only images and PDFs are allowed'));
  }
});

// Helper: upload buffer to Cloudinary
function uploadToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) reject(err); else resolve(result);
    });
    stream.end(buffer);
  });
}

// ── GET /reports — Patient's report dashboard ─────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const snap = await db.collection('reports')
      .where('patientUid', '==', req.user.uid)
      .orderBy('createdAt', 'desc')
      .get();

    const reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.render('reports/index', { title: 'My Medical Reports', reports, user: req.user });
  } catch (err) {
    console.error(err);
    res.render('reports/index', { title: 'My Medical Reports', reports: [], user: req.user, error: err.message });
  }
});

// ── POST /reports/upload — Upload to Cloudinary + save metadata ───────────
router.post('/upload', requireAuth, upload.single('report'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const uid          = req.user.uid;
    const isPDF        = req.file.mimetype === 'application/pdf';
    const resourceType = isPDF ? 'raw' : 'image';

    // Upload to Cloudinary under patient's folder
    const result = await uploadToCloudinary(req.file.buffer, {
      folder:        `swasthyasetu/${uid}/reports`,
      resource_type: resourceType,
      public_id:     `${Date.now()}_${req.file.originalname.replace(/\s+/g, '_')}`,
      use_filename:  true,
    });

    // Save metadata to Firestore
    const reportData = {
      patientUid:   uid,
      filename:     req.file.originalname,
      documentType: req.body.documentType || 'Medical Document',
      cloudinaryUrl: result.secure_url,
      publicId:     result.public_id,
      format:       result.format || (isPDF ? 'pdf' : 'image'),
      size:         result.bytes,
      ocrText:      '',
      extractedData: {},
      ocrStatus:    'pending',
      createdAt:    new Date().toISOString()
    };

    const ref = await db.collection('reports').add(reportData);

    res.json({ success: true, reportId: ref.id, url: result.secure_url, filename: req.file.originalname });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /reports/:id/ocr — Run OCR on an existing report ────────────────
router.post('/:id/ocr', requireAuth, async (req, res) => {
  try {
    const ref  = db.collection('reports').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Report not found' });

    const report = snap.data();
    if (report.patientUid !== req.user.uid) return res.status(403).json({ error: 'Forbidden' });

    // Run OCR
    const { ocrText, extractedData } = await performOCR(report.cloudinaryUrl);

    await ref.update({ ocrText, extractedData, ocrStatus: 'completed', ocrAt: new Date().toISOString() });

    res.json({ success: true, ocrText, extractedData });

  } catch (err) {
    console.error('OCR error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /reports/:id ───────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const ref  = db.collection('reports').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Not found' });

    const report = snap.data();
    if (report.patientUid !== req.user.uid) return res.status(403).json({ error: 'Forbidden' });

    // Delete from Cloudinary
    if (report.publicId) {
      const resourceType = report.format === 'pdf' ? 'raw' : 'image';
      await cloudinary.uploader.destroy(report.publicId, { resource_type: resourceType });
    }

    // Delete from Firestore
    await ref.delete();

    res.json({ success: true });

  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
