export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { text, sl = 'fr', tl = 'uk' } = req.query;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Texte requis' });
  }

  const cleanText = text.trim();

  // 1. Essai prioritaire : Google Translate GTX
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(cleanText)}`;
    const googleRes = await fetch(url);
    if (googleRes.ok) {
      const data = await googleRes.json();
      if (data && data[0] && Array.isArray(data[0])) {
        const translated = data[0].map((item) => item[0]).filter(Boolean).join('');
        return res.status(200).json({ translated });
      }
    }
  } catch (err) {
    console.warn("Échec Google Vercel :", err);
  }

  // 2. Repli : MyMemory Translated
  try {
    const mmUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(cleanText)}&langpair=${encodeURIComponent(sl)}|${encodeURIComponent(tl)}`;
    const mmRes = await fetch(mmUrl);
    if (mmRes.ok) {
      const mmData = await mmRes.json();
      if (mmData?.responseData?.translatedText) {
        return res.status(200).json({ translated: mmData.responseData.translatedText });
      }
    }
  } catch (err) {
    console.warn("Échec MyMemory Vercel :", err);
  }

  return res.status(500).json({ error: "Impossible de traduire pour le moment" });
}
