import type { NextApiRequest, NextApiResponse } from "next";
import { getCollection } from "@/common-content/commonContent";

export const config = { api: { bodyParser: false } };

async function readRawBody(req: NextApiRequest): Promise<string> {
	const chunks: Uint8Array[] = [];
	for await (const c of req) chunks.push(c as Uint8Array);
	return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse
) {
	try {
		const raw = await readRawBody(req);
		let ev: any;
		try {
			ev = JSON.parse(raw);
		} catch {
			return res.status(400).end("Invalid JSON");
		}

		const type = ev?.event;
		const ext =
			ev?.external_id ||
			ev?.data?.external_id ||
			ev?.data?.bot?.metadata?.external_id ||
			ev?.data?.recording?.metadata?.external_id;
		const botId = ev?.data?.bot?.id || ev?.bot_id || ev?.data?.bot_id || null;

		const Bots = await getCollection("RecallBots");
		const Transcripts = await getCollection("RecallTranscripts");
		const Recordings = await getCollection("RecallRecordings");

		if (type === "bot.status_change") {
			const status = ev?.data?.status || "unknown";
			await Bots.updateOne(
				{ ExternalId: ext },
				{ $set: { Status: status, LastEventAt: new Date(), BotId: botId } },
				{ upsert: true }
			);
			if (status === "done" && ext) {
				await resolveAndPersistAssets({ ext, botId, Bots, Recordings });
			}
			return res.status(200).end("ok");
		}

		if (type === "transcript.data" && ext) {
			const words = ev?.data?.data?.words ?? [];
			const text = words
				.map((w: any) => w.text)
				.join(" ")
				.trim();
			const startedAt =
				words[0]?.start_timestamp?.absolute ||
				ev?.data?.data?.start_timestamp?.absolute ||
				new Date().toISOString();
			const speaker =
				ev?.data?.data?.participant?.name ||
				ev?.data?.data?.participant_id ||
				"Unknown";
			await Transcripts.insertOne({
				ExternalId: ext,
				Text: text,
				Words: words,
				Speaker: speaker,
				StartedAt: startedAt,
				CreatedAt: new Date(),
			});
			await Bots.updateOne(
				{ ExternalId: ext },
				{
					$set: { HasTranscript: true, LastEventAt: new Date(), BotId: botId },
				},
				{ upsert: true }
			);
			return res.status(200).end("ok");
		}

		if ((type === "transcript.done" || type === "recording.done") && ext) {
			await resolveAndPersistAssets({ ext, botId, Bots, Recordings });
			return res.status(200).end("ok");
		}

		// Minimal fallback update
		if (ext) {
			await Bots.updateOne(
				{ ExternalId: ext },
				{ $set: { LastEventAt: new Date(), BotId: botId } },
				{ upsert: true }
			);
		}
		return res.status(200).end("ok");
	} catch {
		return res.status(200).end("ok");
	}
}

async function resolveAndPersistAssets({ ext, botId, Bots, Recordings }: any) {
	const apiKey = process.env.RECALL_API_KEY!;
	const region = process.env.RECALL_REGION!;
	if (!apiKey || !region) return;

	let id = botId;
	if (!id) {
		const botDoc = await Bots.findOne(
			{ ExternalId: ext },
			{ projection: { BotId: 1 } }
		);
		id = botDoc?.BotId;
	}
	if (!id) return;

	const base = `https://${region}.recall.ai/api/v1`;
	const headers = { authorization: `Token ${apiKey}` };
	const bot = await fetch(`${base}/bot/${id}`, { headers })
		.then((r) => (r.ok ? r.json() : null))
		.catch(() => null);

	const transcriptUrl =
		bot?.media_shortcuts?.transcript?.data?.download_url || null;
	const mp4Url = bot?.media_shortcuts?.video_mixed_mp4?.download_url || null;
	const mp3Url = bot?.media_shortcuts?.audio_mixed_mp3?.download_url || null;

	await Recordings.updateOne(
		{ ExternalId: ext },
		{
			$set: {
				ExternalId: ext,
				Ready: Boolean(transcriptUrl || mp4Url || mp3Url),
				Assets: {
					transcript_download_url: transcriptUrl,
					video_mixed_mp4_download_url: mp4Url,
					audio_mixed_mp3_download_url: mp3Url,
					bot_id: id,
					resolved_at: new Date().toISOString(),
				},
				UpdatedAt: new Date(),
			},
		},
		{ upsert: true }
	);

	await Bots.updateOne(
		{ ExternalId: ext },
		{
			$set: {
				Status: "done",
				HasRecordings: true,
				LastEventAt: new Date(),
				BotId: id,
			},
		},
		{ upsert: true }
	);
}
