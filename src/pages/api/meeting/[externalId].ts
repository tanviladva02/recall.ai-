import { getCollection } from "@/common-content/commonContent";
import type { NextApiRequest, NextApiResponse } from "next";

function simpleSummary(text: string): { summary: string; bullets: string[] } {
	// Naive extractive summary: first 3 sentences and top bullets by length
	const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
	const top = sentences.slice(0, 3).join(" ");
	const bullets = sentences
		.slice(3, 10)
		.map((s) => (s.length > 140 ? s.slice(0, 137) + "…" : s));
	return { summary: top, bullets };
}

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse
) {
	const { externalId } = req.query as { externalId: string };
	if (!externalId)
		return res
			.status(400)
			.json({ success: false, message: "externalId required" });

	const Bots = await getCollection("RecallBots");
	const Transcripts = await getCollection("RecallTranscripts");
	const Recordings = await getCollection("RecallRecordings");

	const bot = await Bots.findOne({ ExternalId: externalId });
	const rec = await Recordings.findOne({ ExternalId: externalId });
	const segs = await Transcripts.find({ ExternalId: externalId })
		.sort({ StartedAt: 1, _id: 1 })
		.toArray();

	const transcriptText = segs.map((s) => `[${s.Speaker}] ${s.Text}`).join(" ");
	const hasTranscript = segs.length > 0 || !!bot?.HasTranscript;
	const hasRecordings = !!rec?.Ready;

	const { summary, bullets } = transcriptText
		? simpleSummary(transcriptText)
		: { summary: "", bullets: [] };

	return res.json({
		success: true,
		data: {
			externalId,
			status: bot?.Status || "unknown",
			startedAt: bot?.CreatedAt || null,
			lastEventAt: bot?.LastEventAt || null,
			meetingUrl: bot?.MeetingUrl || null,
			hasTranscript,
			hasRecordings,
			transcript: {
				segments: segs.map((s) => ({
					speaker: s.Speaker,
					text: s.Text,
					startedAt: s.StartedAt,
				})),
				text: transcriptText,
			},
			recordings: rec?.Assets || null,
			summary: { text: summary, bullets },
		},
	});
}
