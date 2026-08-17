// One-time migration: links any pre-login data (business profile, invoices,
// estimates, payments) that has no userId to the account you specify.
//
// Run this ONCE, after you have signed up for a new BillBook account, so
// your old data shows up under that account.
//
// Usage:
//   cd backend
//   node migrate-legacy-data.js your-account-email@example.com

import "dotenv/config";
import dns from "node:dns";
import { MongoClient } from "mongodb";

// Some networks / ISPs don't resolve the special DNS "SRV" records that
// mongodb+srv:// connection strings need. Forcing Node to ask Google's DNS
// instead of the system default fixes "querySrv ECONNREFUSED" errors.
dns.setServers(["8.8.8.8", "1.1.1.1"]);

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: node migrate-legacy-data.js your-account-email@example.com");
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set in backend/.env");
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("billbook");

  const user = await db.collection("users").findOne({ email: email.toLowerCase().trim() });
  if (!user) {
    console.error(`No account found for ${email}. Sign up in the app first, then run this script.`);
    await client.close();
    process.exit(1);
  }

  // Old business profile was a single document keyed by _key: "profile"
  // (no userId). Attach it to this user.
  const bizResult = await db.collection("business").updateOne(
    { _key: "profile", userId: { $exists: false } },
    { $set: { userId: user.id }, $unset: { _key: "" } }
  );

  // Old invoices/estimates/payments had no userId at all — attach any that
  // are still unowned.
  const docsResult = await db.collection("documents").updateMany(
    { userId: { $exists: false } },
    { $set: { userId: user.id } }
  );
  const paymentsResult = await db.collection("payments").updateMany(
    { userId: { $exists: false } },
    { $set: { userId: user.id } }
  );

  console.log(`Linked to ${email}:`);
  console.log(`  Business profile updated: ${bizResult.modifiedCount}`);
  console.log(`  Documents (invoices/estimates) linked: ${docsResult.modifiedCount}`);
  console.log(`  Payments linked: ${paymentsResult.modifiedCount}`);
  console.log("Done. Log in to the app with that account — your old data should now appear.");

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
