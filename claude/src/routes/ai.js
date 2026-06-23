import express from 'express';

const router = express.Router();

/* POST /api/ai/parcel-size
   Body: { description: "a pair of shoes in a shoebox" }
   Returns: { size: "medium", confidence: "high", reason: "..." }

   Uses the Anthropic API if ANTHROPIC_API_KEY is set. If not, returns
   { available: false } so the frontend can hide the feature gracefully. */

const SIZE_GUIDE = `
- small: fits in one hand or an envelope (documents, keys, jewelry, a phone)
- medium: about a shoebox (a pair of shoes, a small electronics box, a book stack)
- large: about a carry-on suitcase (a microwave, a large backpack, a car tire)
- xl: bulky / needs two hands or is heavy (a TV, furniture, multiple boxes)
`;

router.post('/parcel-size', async (req, res) => {
  const { description } = req.body || {};
  if (!description || !description.trim()) {
    return res.status(400).json({ error: 'description is required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.json({ available: false });
  }

  try {
    const prompt = `You categorize parcels for a courier app into exactly one size.
Sizes:${SIZE_GUIDE}
Parcel description: "${description.trim()}"

Respond with ONLY a compact JSON object, no other text, in this exact form:
{"size":"small|medium|large|xl","confidence":"high|medium|low","reason":"a short 6-word reason"}`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!r.ok) {
      const txt = await r.text();
      console.error('AI API error:', r.status, txt.slice(0, 200));
      return res.status(502).json({ error: 'AI service unavailable' });
    }

    const data = await r.json();
    const text = (data.content?.[0]?.text || '').trim();

    // Parse the JSON the model returned (strip any stray fences).
    const clean = text.replace(/```json|```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(clean); }
    catch { return res.status(502).json({ error: 'Could not interpret AI response' }); }

    const valid = ['small', 'medium', 'large', 'xl'];
    if (!valid.includes(parsed.size)) {
      return res.status(502).json({ error: 'AI returned an invalid size' });
    }

    res.json({
      available: true,
      size: parsed.size,
      confidence: parsed.confidence || 'medium',
      reason: parsed.reason || '',
    });
  } catch (e) {
    console.error('AI parcel-size error:', e.message);
    res.status(500).json({ error: 'AI request failed' });
  }
});

/* POST /api/ai/verify-size
   Body: { image: "<base64 data URL>", claimedSize: "small" }
   Returns: { available, size, agrees, confidence, reason }
   Looks at the parcel photo and decides the size category. */
router.post('/verify-size', async (req, res) => {
  const { image, claimedSize } = req.body || {};
  if (!image) return res.status(400).json({ error: 'image is required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.json({ available: false });

  // Parse the data URL into media type + base64 data.
  const m = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/i.exec(image);
  if (!m) return res.status(400).json({ error: 'image must be a base64 data URL' });
  const mediaType = m[1].toLowerCase().replace('image/jpg', 'image/jpeg');
  const b64 = m[3];

  try {
    const prompt = `You verify parcel sizes for a courier app by looking at a photo.
Size categories:${SIZE_GUIDE}
The customer claims this parcel is size: "${claimedSize || 'unknown'}".

Look at the photo and decide the most likely size category. Use any visible reference
objects (hands, furniture, doorways) to judge scale. If you genuinely cannot tell the
scale, keep the customer's claimed size.

Respond with ONLY compact JSON, no other text:
{"size":"small|medium|large|xl","confidence":"high|medium|low","reason":"short reason under 10 words"}`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 120,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!r.ok) {
      const txt = await r.text();
      console.error('AI vision error:', r.status, txt.slice(0, 200));
      return res.status(502).json({ error: 'AI service unavailable' });
    }

    const data = await r.json();
    const text = (data.content?.[0]?.text || '').trim().replace(/```json|```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { return res.status(502).json({ error: 'Could not interpret AI response' }); }

    const valid = ['small', 'medium', 'large', 'xl'];
    if (!valid.includes(parsed.size)) {
      return res.status(502).json({ error: 'AI returned an invalid size' });
    }

    res.json({
      available: true,
      size: parsed.size,
      agrees: parsed.size === claimedSize,
      confidence: parsed.confidence || 'medium',
      reason: parsed.reason || '',
    });
  } catch (e) {
    console.error('verify-size error:', e.message);
    res.status(500).json({ error: 'AI request failed' });
  }
});

export default router;