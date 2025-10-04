import { getCollection } from "@/common-content/commonContent";
import type { NextApiRequest, NextApiResponse } from "next";

export const config = { api: { bodyParser: false } };

// Utility to read raw body
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
			res.status(400).end("Invalid JSON");
			return;
		}

		// ACK early
		res.status(200).end("ok");

		const type = ev?.event;
		const ext = ev?.external_id || ev?.data?.bot?.metadata?.external_id;
		if (!ext) return;

		const Bots = await getCollection("RecallBots");
		const Transcripts = await getCollection("RecallTranscripts");
		const Recordings = await getCollection("RecallRecordings");

		// Lifecycle updates
		if (type === "bot.status_change") {
			const status = ev?.data?.status || "unknown";
			await Bots.updateOne(
				{ ExternalId: ext },
				{ $set: { Status: status, LastEventAt: new Date() } },
				{ upsert: true }
			);
			return;
		}

		// Real-time finalized transcript segments
		if (type === "transcript.data") {
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
				{ $set: { HasTranscript: true, LastEventAt: new Date() } }
			);
			return;
		}

		// Post-call: transcript/recording availability
		if (type === "transcript.done" || type === "recording.done") {
			const assets = ev?.data || ev; // store entire payload for traceability
			await Recordings.updateOne(
				{ ExternalId: ext },
				{
					$set: {
						ExternalId: ext,
						Assets: assets,
						Ready: true,
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
					},
				}
			);
			return;
		}

		// Any other events: store minimally
		await Bots.updateOne(
			{ ExternalId: ext },
			{ $set: { LastEventAt: new Date() } },
			{ upsert: true }
		);
	} catch {
		// failures after ACK are intentionally ignored
	}
}
