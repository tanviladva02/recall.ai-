import { getCollection } from '@/common-content/commonContent';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { externalId } = req.query as { externalId: string };
  if (!externalId) return res.status(400).json({ success: false, message: 'externalId required' });

  const Transcripts = await getCollection('RecallTranscripts');
  const segs = await Transcripts.find({ ExternalId: externalId }).sort({ StartedAt: 1, _id: 1 }).toArray();
  const text = segs
    .map((s) => s.Text)
    .join(' ')
    .trim();

  return res.json({
    success: true,
    transcript: {
      externalId,
      segments: segs.map((s) => ({ speaker: s.Speaker, text: s.Text, startedAt: s.StartedAt })),
      text
    }
  });
}
