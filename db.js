import { MongoClient } from "mongodb";

const DEFAULT_BUSINESS = {
  name: "My Business",
  proprietor: "",
  phone: "",
  email: "",
  address: "",
  gstin: "",
  state: "",
  bankName: "",
  accountHolder: "",
  accountNo: "",
  ifsc: "",
  terms: "Thank you for your business.",
  logoDataUrl: "",
};

let client;
let dbPromise;

function getMongoUri() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI environment variable is not set. Add it in your hosting provider's environment variables (see README)."
    );
  }
  return uri;
}

async function connect() {
  if (!client) {
    client = new MongoClient(getMongoUri());
    await client.connect();
  }
  // MongoDB Atlas connection strings usually don't include a database name,
  // so we just use a fixed database name for this app.
  return client.db("billbook");
}

export function getDb() {
  if (!dbPromise) dbPromise = connect();
  return dbPromise;
}

// Ensures a single business profile document exists and returns the collection.
export async function getBusinessCollection() {
  const db = await getDb();
  const col = db.collection("business");
  const existing = await col.findOne({ _key: "profile" });
  if (!existing) {
    await col.insertOne({ _key: "profile", ...DEFAULT_BUSINESS });
  }
  return col;
}

export async function getDocumentsCollection() {
  const db = await getDb();
  return db.collection("documents");
}

export async function getPaymentsCollection() {
  const db = await getDb();
  return db.collection("payments");
}
