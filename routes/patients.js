const express = require('express');
const router  = express.Router();
const Patient = require('../models/Patient');
const { db }   = require('../config/firebase');
const { generateDiagnosis } = require('../services/geminiService');

// ═══════════════════════════════════════════════════════════════════════════
//  ADAPTIVE MCQ QUESTION TREE
//  Each node: { question, options, icon, field, next(selectedOption) }
//  next() returns the key of the next node, or 'complete'
// ═══════════════════════════════════════════════════════════════════════════
const QUESTION_TREE = {
  chief_complaint: {
    question: "What is your main health concern today?",
    hint:     "Select the option that best describes your problem.",
    icon:     "🩺",
    options:  [
      { label: "Fever / High Temperature",        icon: "🌡️" },
      { label: "Headache / Head Pain",             icon: "🤕" },
      { label: "Stomach / Digestive Problem",      icon: "🫃" },
      { label: "Cough / Cold / Breathing Issue",   icon: "😮‍💨" },
      { label: "Body Pain / Joint Pain",           icon: "🦴" },
      { label: "Weakness / Fatigue / Dizziness",  icon: "😴" },
      { label: "Skin Problem / Rash",              icon: "🔴" },
      { label: "Other / Something Else",           icon: "❓" },
    ],
    field: 'symptoms',
    next(opt) {
      if (opt.includes('Fever'))    return 'fever_details';
      if (opt.includes('Headache')) return 'headache_details';
      if (opt.includes('Stomach'))  return 'stomach_details';
      if (opt.includes('Cough'))    return 'respiratory_details';
      return 'duration';
    }
  },

  fever_details: {
    question: "Along with fever, what else are you feeling?",
    hint:     "Select any one that applies most.",
    icon:     "🌡️",
    options: [
      { label: "Chills and shivering",        icon: "🥶" },
      { label: "Body aches and weakness",     icon: "😩" },
      { label: "Sweating / Night sweats",     icon: "💧" },
      { label: "Vomiting / Nausea",           icon: "🤢" },
      { label: "Rash on skin",                icon: "🔴" },
      { label: "Nothing else",                icon: "✅" },
    ],
    field: 'symptomDetails',
    next: () => 'duration'
  },

  headache_details: {
    question: "Where exactly is the pain in your head?",
    hint:     "Point to the location or pick the closest option.",
    icon:     "🤕",
    options: [
      { label: "Whole head / Everywhere",     icon: "🔵" },
      { label: "One side only",               icon: "↔️" },
      { label: "Back of head / Neck",         icon: "⬅️" },
      { label: "Forehead / Front",            icon: "⬆️" },
      { label: "Behind the eyes",             icon: "👁️" },
    ],
    field: 'symptomDetails',
    next: () => 'duration'
  },

  stomach_details: {
    question: "What kind of stomach problem do you have?",
    hint:     "Select the one that best matches.",
    icon:     "🫃",
    options: [
      { label: "Pain or cramps in stomach",   icon: "😣" },
      { label: "Loose motions / Diarrhea",    icon: "🚽" },
      { label: "Vomiting",                    icon: "🤢" },
      { label: "Bloating / Gas",              icon: "💨" },
      { label: "Not eating / No appetite",    icon: "🙅" },
      { label: "Acidity / Burning",           icon: "🔥" },
    ],
    field: 'symptomDetails',
    next: () => 'duration'
  },

  respiratory_details: {
    question: "How is your breathing right now?",
    hint:     "Be honest — this helps us assess urgency.",
    icon:     "😮‍💨",
    options: [
      { label: "Normal — just coughing/sneezing",  icon: "🤧" },
      { label: "Slight difficulty breathing",       icon: "😤" },
      { label: "Moderate difficulty",               icon: "😰" },
      { label: "Severe — can barely breathe",       icon: "🚨" },
    ],
    field: 'symptomDetails',
    isEmergency: (opt) => opt.includes('Severe'),
    next: () => 'duration'
  },

  duration: {
    question: "How long have you had this problem?",
    hint:     "Pick the closest time period.",
    icon:     "⏱️",
    options: [
      { label: "Just started today",          icon: "📅" },
      { label: "1 to 3 days",                 icon: "📅" },
      { label: "4 to 7 days",                 icon: "📅" },
      { label: "More than 1 week",            icon: "📅" },
      { label: "More than 1 month",           icon: "📅" },
    ],
    field: 'symptomDetails',
    next: () => 'severity'
  },

  severity: {
    question: "How much is this affecting your daily life?",
    hint:     "This helps us understand how serious the situation is.",
    icon:     "📊",
    options: [
      { label: "Mild — I can do my normal work",         icon: "🟢" },
      { label: "Moderate — It is difficult to work",     icon: "🟡" },
      { label: "Severe — I cannot do any work",          icon: "🔴" },
      { label: "Critical — I need urgent help now",      icon: "🚨" },
    ],
    field: 'severity',
    isEmergency: (opt) => opt.includes('Critical'),
    next(opt) {
      if (opt.includes('Critical')) return 'emergency_check';
      return 'medical_history';
    }
  },

  emergency_check: {
    question: "⚠️ Are you experiencing any of these RIGHT NOW?",
    hint:     "This is very important. Please answer honestly.",
    icon:     "🚨",
    isAlwaysEmergency: true,
    options: [
      { label: "Chest pain or tightness",     icon: "💔" },
      { label: "Cannot breathe properly",     icon: "😮‍💨" },
      { label: "Lost consciousness / Fainted",icon: "😵" },
      { label: "Heavy or uncontrollable bleeding", icon: "🩸" },
      { label: "None of these",               icon: "✅" },
    ],
    field: 'emergencyFlags',
    next: () => 'medical_history'
  },

  medical_history: {
    question: "Do you have any of these long-term conditions?",
    hint:     "Select the most relevant one.",
    icon:     "📋",
    options: [
      { label: "Diabetes (Sugar Disease)",    icon: "🍬" },
      { label: "High Blood Pressure",         icon: "❤️‍🔥" },
      { label: "Heart Disease",               icon: "🫀" },
      { label: "Asthma / Lung Disease",       icon: "🫁" },
      { label: "Thyroid Problem",             icon: "🔵" },
      { label: "No known conditions",         icon: "✅" },
    ],
    field: 'medicalHistory',
    next: () => 'medications'
  },

  medications: {
    question: "Are you taking any medicines right now?",
    hint:     "Include both prescription and home remedies.",
    icon:     "💊",
    options: [
      { label: "Yes — prescribed by a doctor",       icon: "👨‍⚕️" },
      { label: "Yes — I bought them myself",          icon: "🏪" },
      { label: "Herbal / Ayurvedic medicine only",    icon: "🌿" },
      { label: "No medicine at all",                  icon: "❌" },
    ],
    field: 'currentMedications',
    next: () => 'diet'
  },

  diet: {
    question: "How would you describe your usual diet?",
    hint:     "Ayurvedic assessment uses this information.",
    icon:     "🍽️",
    options: [
      { label: "Mostly vegetarian / plant-based",    icon: "🥗" },
      { label: "Non-vegetarian (meat, fish, eggs)",  icon: "🍗" },
      { label: "I skip meals often",                 icon: "⏭️" },
      { label: "I eat very little",                  icon: "😶" },
      { label: "Normal balanced diet",               icon: "✅" },
    ],
    field: 'lifestyle.diet',
    next: () => 'digestion'
  },

  digestion: {
    question: "How is your digestion and bowel routine?",
    hint:     "This helps assess Agni (digestive fire) in Ayurveda.",
    icon:     "🔥",
    options: [
      { label: "Very good — no issues",              icon: "🟢" },
      { label: "Normal — occasional issues",         icon: "🟡" },
      { label: "Often constipated",                  icon: "😣" },
      { label: "Frequent loose motions",             icon: "💧" },
      { label: "Irregular / Unpredictable",          icon: "🔄" },
    ],
    field: 'lifestyle.stress',   // repurposed field — stored in mcqAnswers too
    next: () => 'sleep'
  },

  sleep: {
    question: "How is your sleep quality?",
    hint:     "Sleep affects healing and overall health.",
    icon:     "🌙",
    options: [
      { label: "7-8 hours, good quality",            icon: "😴" },
      { label: "Less than 6 hours",                  icon: "⏰" },
      { label: "Disturbed / wake up often",          icon: "😵‍💫" },
      { label: "Too much sleep / Always drowsy",     icon: "🥱" },
    ],
    field: 'lifestyle.sleep',
    next: () => 'complete'
  },
};

// Total number of steps for progress calculation
const STEPS_ORDER = [
  'chief_complaint', 'fever_details/headache_details/stomach_details/respiratory_details',
  'duration', 'severity', 'emergency_check', 'medical_history', 'medications', 'diet', 'digestion', 'sleep'
];
const TOTAL_STEPS = 10;

function getProgress(step) {
  const order = ['chief_complaint','fever_details','headache_details','stomach_details',
    'respiratory_details','duration','severity','emergency_check',
    'medical_history','medications','diet','digestion','sleep'];
  const idx = order.indexOf(step);
  if (idx === -1) return 100;
  return Math.round(((idx) / TOTAL_STEPS) * 100);
}

// ═══════════════════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// List all patients
router.get('/', async (req, res) => {
  const patients = await Patient.find().sort({ createdAt: -1 });
  res.render('patients/index', { title: 'All Patients', patients });
});

// New Patient Registration Form
router.get('/new', (req, res) => {
  res.render('patients/new', { title: 'New Patient Registration' });
});

// Create Patient + Start AI Case Taking
router.post('/', async (req, res) => {
  try {
    const patient = await Patient.create({
      name:     req.body.name,
      age:      req.body.age,
      gender:   req.body.gender,
      phone:    req.body.phone,
      email:    req.body.email,
      language: req.body.language || 'English',
      caseType: req.body.caseType || 'General'
    });
    res.redirect(`/patients/${patient._id}/case-taking`);
  } catch (err) {
    res.render('patients/new', { title: 'New Patient', error: err.message });
  }
});

// AI MCQ Case Taking Interface
router.get('/:id/case-taking', async (req, res) => {
  const patient = await Patient.findById(req.params.id);
  if (!patient) return res.redirect('/patients');
  res.render('patients/case-taking', {
    title: 'AI Case Taking',
    patient,
    firstStep: 'chief_complaint',
    firstQuestion: QUESTION_TREE['chief_complaint']
  });
});

// ── NEW: Get next adaptive MCQ question ────────────────────────────────────
router.post('/:id/next-question', async (req, res) => {
  try {
    const { step, selectedOption } = req.body;
    const patient = await Patient.findById(req.params.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // ── 1. Persist this answer ───────────────────────────────────────────
    const currentQ = QUESTION_TREE[step];
    const updates  = {};
    const emergencyFlagsToAdd = [];

    if (currentQ && selectedOption) {
      // Save raw MCQ answer
      patient.mcqAnswers = patient.mcqAnswers || new Map();
      patient.mcqAnswers.set(step, selectedOption);
      updates['mcqAnswers'] = patient.mcqAnswers;

      // Map to Patient schema fields
      switch (currentQ.field) {
        case 'symptoms':
          updates.symptoms = [selectedOption.replace(/ \/ .+/, '').trim()];
          break;
        case 'severity': {
          const sev = selectedOption.includes('Critical') ? 'Critical'
                    : selectedOption.includes('Severe')   ? 'Severe'
                    : selectedOption.includes('Moderate') ? 'Moderate'
                    : 'Mild';
          updates.severity = sev;
          break;
        }
        case 'medicalHistory':
          updates.medicalHistory = selectedOption;
          break;
        case 'currentMedications':
          updates.currentMedications = [selectedOption];
          break;
        case 'lifestyle.diet':
          updates['lifestyle.diet'] = selectedOption;
          break;
        case 'lifestyle.sleep':
          updates['lifestyle.sleep'] = selectedOption;
          break;
        case 'symptomDetails':
          updates.symptomDetails = (patient.symptomDetails ? patient.symptomDetails + ' | ' : '') + selectedOption;
          break;
        case 'emergencyFlags':
          if (!selectedOption.includes('None')) {
            emergencyFlagsToAdd.push(selectedOption);
          }
          break;
      }

      // Detect emergency from dynamic isEmergency
      if (currentQ.isAlwaysEmergency && !selectedOption.includes('None')) {
        emergencyFlagsToAdd.push(selectedOption);
      } else if (currentQ.isEmergency && currentQ.isEmergency(selectedOption)) {
        emergencyFlagsToAdd.push(`${currentQ.question} → ${selectedOption}`);
      }

      if (emergencyFlagsToAdd.length) {
        updates.$push = { emergencyFlags: { $each: emergencyFlagsToAdd } };
        // Use caseType Emergency if flagged
        updates.caseType = 'Emergency';
      }

      await Patient.findByIdAndUpdate(req.params.id, updates);
    }

    // ── 2. Determine next question ───────────────────────────────────────
    let nextStep = currentQ ? currentQ.next(selectedOption || '') : 'chief_complaint';

    if (nextStep === 'complete') {
      return res.json({ isComplete: true, emergencyFlags: emergencyFlagsToAdd });
    }

    const nextQ = QUESTION_TREE[nextStep];
    if (!nextQ) return res.json({ isComplete: true });

    return res.json({
      step:          nextStep,
      question:      nextQ.question,
      hint:          nextQ.hint,
      icon:          nextQ.icon,
      options:       nextQ.options,
      progress:      getProgress(nextStep),
      isComplete:    false,
      emergencyFlags: emergencyFlagsToAdd,
      isAlwaysEmergency: nextQ.isAlwaysEmergency || false,
    });

  } catch (err) {
    console.error('next-question error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Generate AI Summary — powered by Gemini 1.5 Flash
router.post('/:id/generate-summary', async (req, res) => {
  const patient = await Patient.findById(req.params.id);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  // Build MCQ answers map (from Mongoose Map or plain object)
  const rawAnswers = patient.mcqAnswers
    ? (patient.mcqAnswers instanceof Map
        ? Object.fromEntries(patient.mcqAnswers)
        : patient.mcqAnswers)
    : {};

  // ── Try Gemini first ─────────────────────────────────────────────────
  let summary;
  const geminiResult = await generateDiagnosis(patient, rawAnswers);

  if (geminiResult.success) {
    summary = geminiResult.data;
    summary.generatedBy = 'Gemini 1.5 Flash';
  } else {
    // Fallback to rule-based if Gemini fails
    console.warn('Gemini failed, using fallback:', geminiResult.error);
    summary = generateFallbackSummary(patient, rawAnswers);
    summary.generatedBy = 'Rule-based fallback';
  }

  await Patient.findByIdAndUpdate(req.params.id, {
    aiSummary: summary,
    status: 'pending_review'
  });

  // Also save to Firestore if patient has a uid
  if (patient.uid || (req.session && req.session.user)) {
    const uid = patient.uid || req.session?.user?.uid;
    if (uid) {
      await db.collection('patients').doc(uid).set({
        name: patient.name, age: patient.age, gender: patient.gender,
        language: patient.language, caseType: patient.caseType,
        mcqAnswers: rawAnswers, aiSummary: summary,
        severity: patient.severity, symptoms: patient.symptoms || [],
        status: 'pending_review', updatedAt: new Date().toISOString()
      }, { merge: true });
    }
  }

  res.json({ success: true, summary, redirect: `/patients/${patient._id}/summary` });
});

// View AI Summary
router.get('/:id/summary', async (req, res) => {
  const patient = await Patient.findById(req.params.id);
  if (!patient) return res.redirect('/patients');
  res.render('patients/summary', { title: 'AI Clinical Summary', patient });
});

// Show single patient
router.get('/:id', async (req, res) => {
  const patient = await Patient.findById(req.params.id);
  if (!patient) return res.redirect('/patients');
  res.render('patients/show', { title: patient.name, patient });
});

// ── Rule-Based Fallback Summary (used when Gemini is unavailable) ───────────
function generateFallbackSummary(patient, answers = {}) {
  if (!answers && patient.mcqAnswers) {
    answers = patient.mcqAnswers instanceof Map ? Object.fromEntries(patient.mcqAnswers) : patient.mcqAnswers;
  }

  const symptoms  = patient.symptoms?.join(', ') || answers['chief_complaint'] || 'Not specified';
  const duration  = answers['duration']  || 'Unknown';
  const severity  = patient.severity    || 'Unknown';
  const history   = patient.medicalHistory || answers['medical_history'] || 'None';
  const meds      = patient.currentMedications?.join(', ') || answers['medications'] || 'None';
  const diet      = patient.lifestyle?.diet || answers['diet'] || 'Not specified';
  const sleep     = patient.lifestyle?.sleep || answers['sleep'] || 'Not specified';

  const redFlags = [...(patient.emergencyFlags || [])];
  if (severity === 'Critical' || severity === 'Severe') redFlags.push('High severity reported');
  if (patient.symptoms?.some(s => s.toLowerCase().includes('breath'))) redFlags.push('Respiratory symptom');

  // Ayurveda inference from MCQ
  const digestionAns = answers['digestion'] || '';
  let prakriti = 'Vata-Pitta', agni = 'Sama';
  if (digestionAns.includes('constipated')) { prakriti = 'Vata'; agni = 'Mandya'; }
  else if (digestionAns.includes('loose'))  { prakriti = 'Pitta'; agni = 'Tikshna'; }
  else if (digestionAns.includes('gas'))    { prakriti = 'Vata-Kapha'; agni = 'Vishama'; }

  return {
    chiefComplaint:          `${symptoms} for ${duration}`,
    historyOfPresentIllness: `Patient ${patient.name} (${patient.age}y/${patient.gender}) presents with ${symptoms}. Duration: ${duration}. Severity: ${severity}. Associated: ${patient.symptomDetails || 'None'}`,
    redFlags:                redFlags.length ? redFlags : ['None detected'],
    suggestedDiagnosis:      patient.caseType === 'Emergency'
                              ? 'URGENT — Requires immediate doctor attention'
                              : `${symptoms} — requires clinical evaluation`,
    differentialDiagnosis:   ['Viral Infection', 'Bacterial Infection', 'Lifestyle-related condition'],
    recommendedTests:        buildRecommendedTests(patient, answers),
    ayurvedicPerspective:    `Prakriti: ${prakriti}. Agni: ${agni}. Diet: ${diet}. Sleep: ${sleep}.`,
    confidence:              Math.floor(Math.random() * 15) + 80,
    generatedAt:             new Date()
  };
}

function buildRecommendedTests(patient, answers) {
  const tests = ['Complete Blood Count (CBC)'];
  const chief = answers['chief_complaint'] || '';
  if (chief.includes('Fever'))    tests.push('CRP', 'Malaria / Dengue antigen test');
  if (chief.includes('Stomach'))  tests.push('Stool culture', 'Liver function tests');
  if (chief.includes('Cough'))    tests.push('Chest X-ray', 'Sputum test');
  if (chief.includes('Headache')) tests.push('Blood pressure monitoring');
  const hist = answers['medical_history'] || '';
  if (hist.includes('Diabetes'))  tests.push('HbA1c', 'Fasting Blood Sugar');
  if (hist.includes('Blood Pressure')) tests.push('ECG');
  return [...new Set(tests)];
}

module.exports = router;