const mongoose = require('mongoose');

const patientSchema = new mongoose.Schema({
  // Basic Info
  name: { type: String, required: true },
  age: { type: Number, required: true },
  gender: { type: String, enum: ['Male', 'Female', 'Other'], required: true },
  phone: { type: String },
  email: { type: String },
  address: { type: String },
  
  // Language & Accessibility
  language: { type: String, default: 'English' },
  voicePreferred: { type: Boolean, default: false },
  
  // Case Taking - AI Conversation
  caseType: { type: String, enum: ['General', 'Ayurvedic', 'Emergency', 'Follow-up'], default: 'General' },
  symptoms: [{ type: String }],
  symptomDetails: { type: String },
  onsetDate: { type: Date },
  severity: { type: String, enum: ['Mild', 'Moderate', 'Severe', 'Critical'] },

  // MCQ Case-Taking — raw answer log { step: selectedOption }
  mcqAnswers: { type: Map, of: String, default: {} },
  // Emergency flags raised during MCQ session
  emergencyFlags: [{ type: String }],
  
  // Medical History
  medicalHistory: { type: String },
  allergies: [{ type: String }],
  currentMedications: [{ type: String }],
  familyHistory: { type: String },
  lifestyle: {
    diet: String,
    sleep: String,
    exercise: String,
    stress: String,
    addictions: [String]
  },
  
  // Ayurveda Assessment
  ayurvedaProfile: {
    prakriti: { type: String, enum: ['Vata', 'Pitta', 'Kapha', 'Vata-Pitta', 'Pitta-Kapha', 'Vata-Kapha', 'Tridosha'] },
    vikriti: String,
    dosha: String,
    agni: { type: String, enum: ['Mandya', 'Tikshna', 'Vishama', 'Sama'] },
    dhatu: String,
    srotas: String,
    nadi: String,
    jihva: String,
    sabda: String,
    sparsa: String,
    drik: String,
    akruti: String
  },
  
  // AI-Generated Summary
  aiSummary: {
    chiefComplaint: String,
    historyOfPresentIllness: String,
    redFlags: [{ type: String }],
    suggestedDiagnosis: String,
    differentialDiagnosis: [String],
    recommendedTests: [String],
    ayurvedicPerspective: String,
    confidence: { type: Number, min: 0, max: 100 },
    generatedAt: { type: Date, default: Date.now }
  },
  
  // Doctor Validation
  status: { 
    type: String, 
    enum: ['active', 'pending_review', 'reviewed', 'flagged'], 
    default: 'active' 
  },
  doctorNotes: { type: String },
  doctorDiagnosis: { type: String },
  validatedBy: { type: String },
  validatedAt: { type: Date },
  
  // Metadata
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Patient', patientSchema);