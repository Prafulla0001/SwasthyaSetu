// routes/api.js
const express = require('express');
const router = express.Router();
const { getTTSAudio, translateText } = require('../services/ttsService');

// ── GET /api/tts — Stream synthesized speech audio (MP3) ───────────────────
router.get('/tts', async (req, res) => {
  try {
    const text = (req.query.text || '').trim();
    const lang = (req.query.lang || 'en').trim().toLowerCase();
    const translate = req.query.translate !== 'false';

    if (!text) {
      return res.status(400).json({ error: 'Missing text parameter' });
    }

    const { buffer, translatedText } = await getTTSAudio(text, lang, translate);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=86400',
      'X-Translated-Text': encodeURIComponent(translatedText.slice(0, 200))
    });

    res.send(buffer);
  } catch (err) {
    console.error('API TTS error:', err.message);
    res.status(500).json({ error: err.message || 'TTS generation failed' });
  }
});

// ── GET /api/translate — Fast server-side translation ───────────────────────
router.get('/translate', async (req, res) => {
  try {
    const text = (req.query.text || '').trim();
    const lang = (req.query.lang || 'en').trim().toLowerCase();

    if (!text) {
      return res.status(400).json({ error: 'Missing text parameter' });
    }

    const translated = await translateText(text, lang);
    res.json({ original: text, translated, lang });
  } catch (err) {
    console.error('API Translate error:', err.message);
    res.status(500).json({ error: err.message || 'Translation failed' });
  }
});

module.exports = router;
