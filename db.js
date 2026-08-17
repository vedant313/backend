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
  // Theme: either a preset name (see frontend/src/utils/themes.js) or a custom
  // set of colors the user picked in the theme builder.
  theme: { preset: "ocean", custom: null },
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

// ---- Users (auth) ----
export async function getUsersCollection() {
  const db = await getDb();
  const col = db.collection("users");
  await col.createIndex({ email: 1 }, { unique: true }).catch(() => {});
  return col;
}

// Every user gets their own business profile, invoices/estimates and
// payments, scoped by userId, so multiple people can sign up and use the
// same deployment without seeing each other's data.

// Ensures a business profile document exists for this user and returns the collection.
export async function getBusinessCollection(userId) {
  const db = await getDb();
  const col = db.collection("business");
  const existing = await col.findOne({ userId });
  if (!existing) {
    await col.insertOne({ userId, ...DEFAULT_BUSINESS });
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
