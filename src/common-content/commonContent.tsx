import clientPromise from "@/lib/db/dbConnection";

export async function getCollection(collectionName: string) {
	const client = await clientPromise;
	return client.db("Projects").collection(collectionName);
}
