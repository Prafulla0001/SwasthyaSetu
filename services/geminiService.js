// ── Gemini AI Diagnosis Service ───────────────────────────────────────────
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Generate a clinically-grounded diagnosis from MCQ answers via Gemini 1.5 Flash.
 * Returns structured JSON matching the aiSummary shape.
 */
async function generateDiagnosis(patient, mcqAnswers) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const answerLines = Object.entries(mcqAnswers)
    .map(([step, answer]) => `  - ${step.replace(/_/g, ' ')}: ${answer}`)
    .join('\n');

  const prompt = `You are a clinical AI assistant supporting an AYUSH/Government health worker in rural India.
Your role is to generate a structured, clinically-sound preliminary assessment based on patient-reported MCQ answers.
This is NOT a final diagnosis — it is a pre-consultation summary for a licensed doctor to review.

Patient Details:
  Name: ${patient.name}
  Age: ${patient.age} years
  Gender: ${patient.gender}
  Language: ${patient.language}
  Case Type: ${patient.caseType || 'General'}

Patient's MCQ Answers (self-reported):
${answerLines}

Generate a structured clinical summary as a valid JSON object with EXACTLY these fields:
{
  "chiefComplaint": "One-line summary of the main complaint and duration",
  "historyOfPresentIllness": "2-3 sentence clinical narrative based on the answers",
  "redFlags": ["List each red flag detected, or ['None detected'] if none"],
  "suggestedDiagnosis": "Most likely clinical impression (be specific, e.g. 'Acute Viral Upper Respiratory Infection')",
  "differentialDiagnosis": ["2nd possibility", "3rd possibility", "4th possibility"],
  "recommendedTests": ["CBC", "Other relevant tests based on symptoms"],
  "ayurvedicPerspective": "Prakriti assessment and Dosha imbalance based on diet/digestion/sleep answers",
  "confidence": 82,
  "urgencyLevel": "routine",
  "clinicalNotes": "Any important observations for the reviewing doctor"
}

urgencyLevel must be one of: "routine", "urgent", "emergency"
confidence must be a number 60-95 based on completeness of data.
Respond ONLY with valid JSON — no markdown, no extra text.`;

  try {
    const result  = await model.generateContent(prompt);
    const text    = result.response.text().trim();
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed  = JSON.parse(cleaned);
    parsed.generatedAt = new Date();
    return { success: true, data: parsed };
  } catch (err) {
    console.error('Gemini error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { generateDiagnosis };
