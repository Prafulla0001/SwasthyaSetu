// services/ttsService.js
const https = require('https');

// Simple in-memory cache for audio buffers and translations
const audioCache = new Map();
const translationCache = new Map();

/**
 * Server-side Google Translate helper with browser user-agent
 * to avoid CORS and bot-detection blocks.
 */
function translateText(text, targetLang) {
  if (!targetLang || targetLang === 'en' || !text) {
    return Promise.resolve(text);
  }

  const cacheKey = `${targetLang}:${text}`;
  if (translationCache.has(cacheKey)) {
    return Promise.resolve(translationCache.get(cacheKey));
  }

  return new Promise((resolve) => {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const translated = json[0].map(item => item[0]).join('') || text;
          translationCache.set(cacheKey, translated);
          resolve(translated);
        } catch (err) {
          console.error('Translation parse error:', err.message);
          resolve(text);
        }
      });
    }).on('error', (err) => {
      console.error('Translation network error:', err.message);
      resolve(text);
    });
  });
}

/**
 * Split long text into natural chunks <= maxLen chars
 * to stay within Google Translate TTS limit (~180 chars).
 */
function splitTextIntoChunks(text, maxLen = 160) {
  if (text.length <= maxLen) return [text];

  const sentences = text.match(/[^.!?।?,;\n]+[.!?।?,;\n]*/g) || [text];
  const chunks = [];
  let current = '';

  for (const s of sentences) {
    if ((current + s).length <= maxLen) {
      current += s;
    } else {
      if (current.trim()) chunks.push(current.trim());
      if (s.length <= maxLen) {
        current = s;
      } else {
        const words = s.split(' ');
        let sub = '';
        for (const w of words) {
          if ((sub + ' ' + w).length <= maxLen) {
            sub += (sub ? ' ' : '') + w;
          } else {
            if (sub.trim()) chunks.push(sub.trim());
            sub = w;
          }
        }
        current = sub;
      }
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)];
}

/**
 * Fetch a single audio chunk from Google Translate TTS.
 */
function fetchAudioChunk(text, lang) {
  return new Promise((resolve, reject) => {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(text)}`;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };

    https.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Google TTS returned status ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

/**
 * Get synthesized speech audio MP3 buffer for any language,
 * translating from English if needed and handling chunk concatenation.
 */
async function getTTSAudio(text, lang = 'en', shouldTranslate = true) {
  if (!text || !text.trim()) {
    throw new Error('Text is required for TTS');
  }

  let spokenText = text.trim();
  if (shouldTranslate && lang !== 'en') {
    spokenText = await translateText(spokenText, lang);
  }

  const cacheKey = `${lang}:${spokenText}`;
  if (audioCache.has(cacheKey)) {
    return { buffer: audioCache.get(cacheKey), translatedText: spokenText };
  }

  const chunks = splitTextIntoChunks(spokenText, 160);
  const audioBuffers = [];

  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    try {
      const buf = await fetchAudioChunk(chunk.trim(), lang);
      audioBuffers.push(buf);
    } catch (err) {
      console.error(`Error fetching TTS chunk for "${chunk}":`, err.message);
    }
  }

  if (audioBuffers.length === 0) {
    throw new Error('Failed to generate audio for any text chunk');
  }

  const finalBuffer = Buffer.concat(audioBuffers);

  // Keep cache to a reasonable size (~200 items)
  if (audioCache.size > 200) {
    const firstKey = audioCache.keys().next().value;
    audioCache.delete(firstKey);
  }
  audioCache.set(cacheKey, finalBuffer);

  return { buffer: finalBuffer, translatedText: spokenText };
}

module.exports = {
  translateText,
  getTTSAudio
};
