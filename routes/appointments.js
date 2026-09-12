const express     = require('express');
const router      = express.Router();
const multer      = require('multer');
const cloudinary  = require('../config/cloudinary');
const { db }      = require('../config/firebase');
const requireAuth = require('../middleware/auth');
const { performOCR } = require('../services/ocrService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 }
});

function uploadToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, r) => {
      if (err) reject(err); else resolve(r);
    });
    stream.end(buffer);
  });
}

// ── GET /appointments/new ─────────────────────────────────────────────────
// Show form: choose existing report OR upload new one
router.get('/new', requireAuth, async (req, res) => {
  try {
    // Load patient's existing reports
    const snap = await db.collection('reports')
      .where('patientUid', '==', req.user.uid)
      .orderBy('createdAt', 'desc')
      .get();
    const reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Load available doctors
    const docSnap = await db.collection('users').where('role', '==', 'doctor').get();
    const doctors = docSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    res.render('appointments/new', {
      title: 'Book Appointment',
      reports,
      doctors,
      user: req.user,
      error: null
    });
  } catch (err) {
    console.error(err);
    res.render('appointments/new', {
      title: 'Book Appointment',
      reports: [], doctors: [],
      user: req.user,
      error: err.message
    });
  }
});

// ── POST /appointments — Create appointment + handle report + run OCR ──────
router.post('/', requireAuth, upload.single('newReport'), async (req, res) => {
  try {
    const { doctorId, scheduledAt, appointmentType, existingReportIds, notes } = req.body;
    const uid = req.user.uid;

    let reportIdsUsed = [];
    let ocrResults    = [];

    // ── 1. Handle existing report selections ──────────────────────────────
    if (existingReportIds) {
      const ids = Array.isArray(existingReportIds) ? existingReportIds : [existingReportIds];
      for (const rid of ids) {
        const rSnap = await db.collection('reports').doc(rid).get();
        if (!rSnap.exists || rSnap.data().patientUid !== uid) continue;

        const rData = rSnap.data();
        reportIdsUsed.push(rid);

        // Run OCR if not done yet
        if (rData.ocrStatus !== 'completed') {
          const ocr = await performOCR(rData.cloudinaryUrl);
          await db.collection('reports').doc(rid).update({
            ocrText:       ocr.ocrText,
            extractedData: ocr.extractedData,
            ocrStatus:    'completed',
            ocrAt:         new Date().toISOString()
          });
          ocrResults.push({ reportId: rid, filename: rData.filename, ...ocr });
        } else {
          ocrResults.push({ reportId: rid, filename: rData.filename, ocrText: rData.ocrText, extractedData: rData.extractedData });
        }
      }
    }

    // ── 2. Handle newly uploaded report ───────────────────────────────────
    if (req.file) {
      const isPDF        = req.file.mimetype === 'application/pdf';
      const resourceType = isPDF ? 'raw' : 'image';

      const uploadResult = await uploadToCloudinary(req.file.buffer, {
        folder:        `swasthyasetu/${uid}/reports`,
        resource_type: resourceType,
        public_id:     `appt_${Date.now()}_${req.file.originalname.replace(/\s+/g, '_')}`,
      });

      const newReport = {
        patientUid:    uid,
        filename:      req.file.originalname,
        documentType:  req.body.newDocumentType || 'Medical Document',
        cloudinaryUrl: uploadResult.secure_url,
        publicId:      uploadResult.public_id,
        format:        uploadResult.format || (isPDF ? 'pdf' : 'image'),
        size:          uploadResult.bytes,
        ocrStatus:     'processing',
        createdAt:     new Date().toISOString()
      };

      const newRef = await db.collection('reports').add(newReport);
      reportIdsUsed.push(newRef.id);

      // Run OCR
      const ocr = await performOCR(uploadResult.secure_url);
      await newRef.update({ ocrText: ocr.ocrText, extractedData: ocr.extractedData, ocrStatus: 'completed', ocrAt: new Date().toISOString() });
      ocrResults.push({ reportId: newRef.id, filename: req.file.originalname, ...ocr });
    }

    // ── 3. Create appointment in Firestore ─────────────────────────────────
    const apptData = {
      patientUid:      uid,
      patientName:     req.user.name,
      doctorId:        doctorId || null,
      scheduledAt:     scheduledAt || null,
      appointmentType: appointmentType || 'General',
      reportIds:       reportIdsUsed,
      ocrSummary:      ocrResults.map(r => ({
        filename:      r.filename,
        documentType:  r.extractedData?.documentType || 'Document',
        ocrText:       r.ocrText?.slice(0, 500) || '',
        keyFindings:   r.extractedData || {}
      })),
      notes:           notes || '',
      status:          'pending',
      createdAt:       new Date().toISOString()
    };

    const apptRef = await db.collection('appointments').add(apptData);

    res.redirect(`/appointments/${apptRef.id}/confirmation`);

  } catch (err) {
    console.error('Appointment create error:', err);
    res.status(500).send('Error creating appointment: ' + err.message);
  }
});

// ── GET /appointments/:id/confirmation ────────────────────────────────────
router.get('/:id/confirmation', requireAuth, async (req, res) => {
  const snap = await db.collection('appointments').doc(req.params.id).get();
  if (!snap.exists) return res.redirect('/appointments/new');
  res.render('appointments/confirmation', {
    title: 'Appointment Confirmed',
    appointment: { id: snap.id, ...snap.data() },
    user: req.user
  });
});

// ── GET /appointments — Patient's appointment list ────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const snap = await db.collection('appointments')
    .where('patientUid', '==', req.user.uid)
    .orderBy('createdAt', 'desc')
    .get();
  const appointments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  res.render('appointments/index', { title: 'My Appointments', appointments, user: req.user });
});

module.exports = router;
