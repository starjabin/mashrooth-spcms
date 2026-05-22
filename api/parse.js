const pdfParse = require('pdf-parse');
const AdmZip   = require('adm-zip');
const { verifyToken, setCORS, setSecurityHeaders } = require('./_auth');

// Max base64 content length (~7.5 MB decoded when base64 is 10 MB)
const MAX_B64_LENGTH = 14_000_000;

async function handler(req, res) {
  setCORS(req, res, 'POST,OPTIONS');
  setSecurityHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // ── Auth: require a valid logged-in session ────────────────────────────────
  const user = await verifyToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: 'Authentication required to upload documents' });

  try {
    const { content, name = '', type = '' } = req.body || {};
    if (!content || typeof content !== 'string')
      return res.status(400).json({ error: 'No file content provided' });

    // Pre-validate size before decoding — avoids allocating a huge buffer
    if (content.length > MAX_B64_LENGTH)
      return res.status(413).json({ error: 'File too large. Maximum size is 10 MB.' });

    const buffer = Buffer.from(content, 'base64');

    const safeName = String(name).slice(0, 255);
    const isPDF  = type === 'application/pdf' || safeName.toLowerCase().endsWith('.pdf');
    const isDOCX = type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                   safeName.toLowerCase().endsWith('.docx');

    let text = '';

    if (isPDF) {
      const data = await pdfParse(buffer);
      text = data.text || '';
    } else if (isDOCX) {
      const zip    = new AdmZip(buffer);
      const docXml = zip.readAsText('word/document.xml');
      text = docXml
        .replace(/<w:p\b[^>]*>/gi,         '\n')
        .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi, '$1')
        .replace(/<[^>]+>/g,               '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/[ \t]+/g,  ' ')
        .replace(/\n{3,}/g,  '\n\n')
        .trim();
    } else {
      // Plain text fallback
      text = buffer.toString('utf8');
    }

    if (!text.trim())
      return res.status(422).json({
        error: 'Could not extract text. The file may be scanned or image-based. Please copy and paste the text manually.',
      });

    return res.status(200).json({ text, chars: text.length, name: safeName });

  } catch (_) {
    return res.status(500).json({ error: 'File could not be processed. Please check the file and try again.' });
  }
}

// Correct way to attach config to a named handler function
handler.config = { api: { bodyParser: { sizeLimit: '10mb' } } };

module.exports = handler;
