import { getCollection } from "@/common-content/commonContent";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse
) {
	const { externalId } = req.query as { externalId: string };
	if (!externalId)
		return res
			.status(400)
			.json({ success: false, message: "externalId required" });

	const Recordings = await getCollection("RecallRecordings");
	const Bots = await getCollection("RecallBots");
	let rec = await Recordings.findOne({ ExternalId: externalId });

	if (!rec?.Ready) {
		const apiKey = process.env.RECALL_API_KEY;
		const region = process.env.RECALL_REGION;
		const botDoc = await Bots.findOne(
			{ ExternalId: externalId },
			{ projection: { BotId: 1 } }
		);
		if (apiKey && region && botDoc?.BotId) {
			const base = `https://${region}.recall.ai/api/v1`;
			const headers = { authorization: `Token ${apiKey}` };
			const bot = await fetch(`${base}/bot/${botDoc.BotId}`, { headers })
				.then((r) => (r.ok ? r.json() : null))
				.catch(() => null);
			const transcriptUrl =
				bot?.media_shortcuts?.transcript?.data?.download_url || null;
			const mp4Url =
				bot?.media_shortcuts?.video_mixed_mp4?.download_url || null;
			const mp3Url =
				bot?.media_shortcuts?.audio_mixed_mp3?.download_url || null;

			if (transcriptUrl || mp4Url || mp3Url) {
				await Recordings.updateOne(
					{ ExternalId: externalId },
					{
						$set: {
							Ready: true,
							Assets: {
								transcript_download_url: transcriptUrl,
								video_mixed_mp4_download_url: mp4Url,
								audio_mixed_mp3_download_url: mp3Url,
								bot_id: botDoc.BotId,
								resolved_at: new Date().toISOString(),
							},
							UpdatedAt: new Date(),
						},
					},
					{ upsert: true }
				);
				rec = await Recordings.findOne({ ExternalId: externalId });
			}
		}
	}

	return res.json({
		success: true,
		externalId,
		ready: !!rec?.Ready,
		assets: rec?.Assets || null,
	});
}
