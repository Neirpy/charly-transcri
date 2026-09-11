export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    status: "online",
    has_gemini: false,
    has_vosk: false,
    default_engine: "webspeech"
  });
}
