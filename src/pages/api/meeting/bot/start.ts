import { getCollection } from "@/common-content/commonContent";
import type { NextApiRequest, NextApiResponse } from "next";

function deriveExternalId(ev: any): string {
	const eventId = ev?.EventId || ev?.id;
	const iCalUID = ev?.ICalUID || ev?.iCalUID;
	const ost = ev?.OriginalStartTime || ev?.originalStartTime;
	const ostVal = ost?.dateTime || ost?.date;
	// Prefer a composite for recurring instances; else the event id
	if (iCalUID && ostVal) return `${iCalUID}__${ostVal}`;
	return String(eventId);
}

function getMeetingUrl(ev: any): string | null {
	const cd = ev?.ConferenceData || ev?.conferenceData;
	const points: Array<{ entryPointType?: string; uri?: string }> | undefined =
		cd?.entryPoints;
	const video = Array.isArray(points)
		? points.find((p) => p.entryPointType === "video" && !!p.uri)
		: undefined;
	const hangout = ev?.HangoutLink || ev?.hangoutLink || null;
	return video?.uri || hangout || null;
}

export default async (req: any, res: NextApiResponse) => {
	try {
		if (req.method !== "POST")
			return res
				.status(405)
				.json({ success: false, message: "Method not allowed" });

		const userId = "HbvsyQHnmzGVuji1WOeJ9";
		const { eventId, calendarId, options } = req.body || {};
		if (!eventId || !calendarId) {
			return res.status(400).json({
				success: false,
				message: "eventId and calendarId are required",
			});
		}

		const Events = await getCollection("Events");
		const ev = await Events.findOne({
			UserId: userId,
			CalendarId: calendarId,
			EventId: eventId,
		});
		if (!ev)
			return res
				.status(404)
				.json({ success: false, message: "Event not found" });

		const meetingUrl = getMeetingUrl(ev);
		if (!meetingUrl)
			return res
				.status(400)
				.json({ success: false, message: "No meeting URL on this event" });

		const externalId = deriveExternalId(ev);

		const apiKey = process.env.RECALL_API_KEY;
		const region = process.env.RECALL_REGION || "us-west-2";
		const webhookUrl = `${process.env.DOAMIN}/api/recall/webhook`;
		if (!apiKey) {
			return res.status(500).json({
				success: false,
				message: "Server missing Recall configuration",
			});
		}

		const useRealtime = options?.realtime !== false; // default true
		const useCaptions = options?.captions === true; // default false

		const transcriptProvider = useCaptions
			? { meeting_captions: {} }
			: { recallai_streaming: {} };

		const recording_config: any = {
			transcript: { provider: transcriptProvider },
			video_mixed_mp4: {},
			audio_mixed_mp3: {},
		};
		if (useRealtime) {
			recording_config.real_time_endpoints = [
				{
					type: "webhook",
					url: webhookUrl,
					events: [
						"transcript.data",
						"transcript.partial_data",
						"bot.status_change",
					],
				},
			];
		}

		const payload = {
			meeting_url: meetingUrl,
			external_id: externalId,
			metadata: { external_id: externalId, calendarId, eventId },
			webhook_url: webhookUrl,
			recording_config,
		};

		const resp = await fetch(`https://${region}.recall.ai/api/v1/bot`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Token ${apiKey}`,
			},
			body: JSON.stringify(payload),
		});
		const data = await resp.json();
		if (!resp.ok)
			return res
				.status(resp.status)
				.json({ success: false, error: data?.detail || "Bot creation failed" });

		const Bots = await getCollection("RecallBots");
		await Bots.updateOne(
			{ ExternalId: externalId },
			{
				$set: {
					ExternalId: externalId,
					BotId: data.id,
					UserId: userId,
					CalendarId: calendarId,
					EventId: eventId,
					MeetingUrl: meetingUrl,
					Status: "joining",
					CreatedAt: new Date(),
				},
			},
			{ upsert: true }
		);

		return res.json({ success: true, externalId, bot: { id: data.id } });
	} catch (e: any) {
		return res.status(500).json({ success: false, error: e.message });
	}
};
