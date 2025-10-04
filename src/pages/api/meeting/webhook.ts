import type { NextApiRequest, NextApiResponse } from "next";
import { getCollection } from "@/common-content/commonContent";

export const config = { api: { bodyParser: false } };

async function readRawBody(req: NextApiRequest): Promise<string> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of req) chunks.push(chunk);
	return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse
) {
	try {
		const raw = await readRawBody(req);
		let event: any;

		try {
			event = JSON.parse(raw);
		} catch {
			return res.status(400).send("Invalid JSON");
		}

		const type = event?.event;
		const externalId =
			event?.external_id ||
			event?.data?.external_id ||
			event?.data?.bot?.metadata?.external_id ||
			event?.data?.recording?.metadata?.external_id;

		const botId =
			event?.data?.bot?.id || event?.bot_id || event?.data?.bot_id || null;

		const Bots = await getCollection("RecallBots");
		const Transcripts = await getCollection("RecallTranscripts");
		const Recordings = await getCollection("RecallRecordings");

		// 💡 1. Bot status changed
		if (type === "bot.status_change") {
			const status = event?.data?.status || "unknown";

			await Bots.updateOne(
				{ ExternalId: externalId },
				{ $set: { Status: status, LastEventAt: new Date(), BotId: botId } },
				{ upsert: true }
			);

			if (status === "done" && externalId) {
				await resolveAndPersistAssets({ externalId, botId, Bots, Recordings });
			}
			return res.status(200).send("ok");
		}

		// 🧠 2. Real-time transcript data
		if (type === "transcript.data" && externalId) {
			const words = event?.data?.data?.words ?? [];
			const text = words
				.map((w: any) => w.text)
				.join(" ")
				.trim();
			const startedAt =
				words[0]?.start_timestamp?.absolute ||
				event?.data?.data?.start_timestamp?.absolute ||
				new Date().toISOString();
			const speaker =
				event?.data?.data?.participant?.name ||
				event?.data?.data?.participant_id ||
				"Unknown";

			await Transcripts.insertOne({
				ExternalId: externalId,
				Text: text,
				Words: words,
				Speaker: speaker,
				StartedAt: startedAt,
				CreatedAt: new Date(),
			});

			await Bots.updateOne(
				{ ExternalId: externalId },
				{
					$set: {
						HasTranscript: true,
						LastEventAt: new Date(),
						BotId: botId,
					},
				},
				{ upsert: true }
			);

			return res.status(200).send("ok");
		}

		// 📦 3. When full recording or transcript is ready
		if (
			(type === "transcript.done" || type === "recording.done") &&
			externalId
		) {
			await resolveAndPersistAssets({ externalId, botId, Bots, Recordings });
			return res.status(200).send("ok");
		}

		// 📌 4. Fallback: update last activity
		if (externalId) {
			await Bots.updateOne(
				{ ExternalId: externalId },
				{ $set: { LastEventAt: new Date(), BotId: botId } },
				{ upsert: true }
			);
		}

		return res.status(200).send("ok");
	} catch (err: any) {
		console.error("Webhook handler error:", err.message);
		return res.status(500).send(err);
	}
}

// 💾 Fetch & store assets (recordings, transcript download links)
async function resolveAndPersistAssets({
	externalId,
	botId,
	Bots,
	Recordings,
}: {
	externalId: string;
	botId: string | null;
	Bots: any;
	Recordings: any;
}) {
	const apiKey = process.env.RECALL_API_KEY!;
	const region = process.env.RECALL_REGION || "us-west-2";
	if (!apiKey) return;

	let id = botId;

	if (!id) {
		const botDoc = await Bots.findOne(
			{ ExternalId: externalId },
			{ projection: { BotId: 1 } }
		);
		id = botDoc?.BotId;
	}
	if (!id) return;

	const base = `https://${region}.recall.ai/api/v1`;
	const headers = { authorization: `Token ${apiKey}` };

	const bot = await fetch(`${base}/bot/${id}`, { headers })
		.then((res) => (res.ok ? res.json() : null))
		.catch((err) => {
			console.error("Failed to fetch bot", err);
			return null;
		});

	if (!bot) return;

	const transcriptUrl =
		bot?.media_shortcuts?.transcript?.data?.download_url ?? null;
	const mp4Url = bot?.media_shortcuts?.video_mixed_mp4?.download_url ?? null;
	const mp3Url = bot?.media_shortcuts?.audio_mixed_mp3?.download_url ?? null;

	await Recordings.updateOne(
		{ ExternalId: externalId },
		{
			$set: {
				ExternalId: externalId,
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
		{ ExternalId: externalId },
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
