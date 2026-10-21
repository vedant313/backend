import { MongoClient } from "mongodb";

const DEFAULT_BUSINESS = {
  name: "My Business", proprietor: "", phone: "", email: "", address: "", gstin: "", state: "",
  bankName: "", accountHolder: "", accountNo: "", ifsc: "",
  terms: "Thank you for your business.", logoDataUrl: "",
  theme: { preset: "ocean", custom: null },
};

let client;
let dbPromise;

function getMongoUri() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI environment variable is not set. Add it in your hosting provider's environment variables (see README).");
  return uri;
}
async function connect() {
  if (!client) { client = new MongoClient(getMongoUri()); await client.connect(); }
  return client.db("billbook");
}
export function getDb() {
  if (!dbPromise) dbPromise = connect();
  return dbPromise;
}
export async function getUsersCollection() {
  const db = await getDb();
  const col = db.collection("users");
  await col.createIndex({ email: 1 }, { unique: true }).catch(() => {});
  // Sparse unique index leaves legacy accounts without a phone field untouched.
  await col.createIndex({ phone: 1 }, { unique: true, sparse: true }).catch((err) => {
    console.error("Could not create unique phone index; check duplicate phone values.", err.code || "index_error");
  });
  return col;
}
export async function getBusinessCollection(userId) {
  const db = await getDb();
  const col = db.collection("business");
  const existing = await col.findOne({ userId });
  if (!existing) await col.insertOne({ userId, ...DEFAULT_BUSINESS });
  return col;
}
export async function getDocumentsCollection() {
  const db = await getDb();
  const col = db.collection("documents");
  await col.createIndex({ userId: 1, type: 1, date: -1 }).catch(() => {});
  return col;
}
export async function getPaymentsCollection() {
  const db = await getDb();
  const col = db.collection("payments");
  await col.createIndex({ userId: 1, date: -1 }).catch(() => {});
  return col;
}
export async function getExpensesCollection() {
  const db = await getDb();
  const col = db.collection("expenses");
  await col.createIndex({ userId: 1, date: -1 }).catch(() => {});
  await col.createIndex({ userId: 1, category: 1 }).catch(() => {});
  return col;
}
