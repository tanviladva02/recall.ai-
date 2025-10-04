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
	const rec = await Recordings.findOne({ ExternalId: externalId });

	return res.json({
		success: true,
		externalId,
		ready: !!rec?.Ready,
		assets: rec?.Assets || null,
	});
}
