// ── Google Cloud Vision OCR Service ──────────────────────────────────────
// Uses Vision REST API with API key — no service account needed.

/**
 * Run OCR on a Cloudinary image/PDF URL using Google Cloud Vision.
 * Returns { ocrText, extractedData }
 */
async function performOCR(imageUrl) {
  try {
    const apiKey = process.env.GOOGLE_CLOUD_VISION_KEY;
    if (!apiKey) throw new Error('GOOGLE_CLOUD_VISION_KEY not set');

    const endpoint = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
    const body = {
      requests: [{
        image:    { source: { imageUri: imageUrl } },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }]
      }]
    };

    const res  = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });

    if (!res.ok) throw new Error(`Vision API error: ${res.status}`);

    const json = await res.json();
    const text = json.responses?.[0]?.fullTextAnnotation?.text || '';

    return { ocrText: text, extractedData: extractMedicalFields(text) };

  } catch (err) {
    console.error('OCR Service Error:', err.message);
    // Fallback: return the error message so the UI can show it
    return { ocrText: `OCR Error: ${err.message}`, extractedData: {} };
  }
}

/**
 * Heuristic extraction of common medical fields from raw OCR text.
 */
function extractMedicalFields(text) {
  const extracted = {};
  const patterns  = {
    hemoglobin:   /(?:hemoglobin|hb)[:\s]+([0-9.]+\s*(?:g\/dl)?)/i,
    wbc:          /(?:wbc|white blood|leukocytes?)[:\s]+([0-9,]+\s*(?:\/cmm|\/μl|cells)?)/i,
    rbc:          /(?:rbc|red blood)[:\s]+([0-9.]+\s*(?:million\/cmm|M\/μl)?)/i,
    platelets:    /(?:platelets?|plt)[:\s]+([0-9,.]+\s*(?:lakh|lakhs|\/cmm|k\/μl)?)/i,
    glucose:      /(?:glucose|blood sugar|fbs)[:\s]+([0-9.]+\s*(?:mg\/dl)?)/i,
    creatinine:   /creatinine[:\s]+([0-9.]+\s*(?:mg\/dl)?)/i,
    bloodPressure:/(?:blood pressure|bp)[:\s]+([0-9]+\/[0-9]+\s*(?:mmhg)?)/i,
    temperature:  /(?:temp(?:erature)?)[:\s]+([0-9.]+\s*(?:°?[CF])?)/i,
    dateOfReport: /(?:date|dated?)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    doctorName:   /(?:dr\.?|doctor)[:\s]+([A-Za-z\s.]+?)(?:\n|,|$)/i,
  };

  for (const [field, pattern] of Object.entries(patterns)) {
    const match = text.match(pattern);
    if (match) extracted[field] = match[1].trim();
  }

  // Extract medicines list from prescription
  const medMatches = text.matchAll(/(?:tab(?:let)?|cap(?:sule)?|syp|inj)[.\s]+([A-Za-z0-9\s]+)[\s\-]+([0-9]+\s*mg)/gi);
  const medicines  = [...medMatches].map(m => `${m[1].trim()} ${m[2].trim()}`);
  if (medicines.length) extracted.medicines = medicines;

  // Determine document type from content
  extracted.documentType = detectDocType(text);

  return extracted;
}

function detectDocType(text) {
  const lower = text.toLowerCase();
  if (lower.includes('prescription') || lower.includes('rx') || lower.includes('tab ') || lower.includes('syrup'))
    return 'Prescription';
  if (lower.includes('x-ray') || lower.includes('mri') || lower.includes('ct scan') || lower.includes('ultrasound'))
    return 'Imaging';
  if (lower.includes('blood') || lower.includes('cbc') || lower.includes('hemoglobin') || lower.includes('glucose'))
    return 'Lab Report';
  if (lower.includes('discharge') || lower.includes('admitted') || lower.includes('ward'))
    return 'Discharge Summary';
  return 'Medical Document';
}

module.exports = { performOCR };
