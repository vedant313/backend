import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getDb, getBusinessCollection } from "../db.js";

const router = Router();
const MAX_COMPANIES = 5;

function cleanCompany(company) {
  const { _id, userId, ...safe } = company;
  return safe;
}

// Company profiles are separate from legacy business settings. Existing business data is preserved.
router.get("/", async (req, res) => {
  try {
    const db = await getDb();
    const companies = db.collection("companies");
    let rows = await companies.find({ userId: req.userId }, { projection: { _id: 0, userId: 0 } }).sort({ createdAt: 1 }).toArray();
    if (!rows.length) {
      const legacy = await (await getBusinessCollection(req.userId)).findOne({ userId: req.userId }, { projection: { _id: 0 } });
      const now = new Date().toISOString();
      const initial = {
        id: uuid(), userId: req.userId, name: legacy?.name || "My Business",
        proprietor: legacy?.proprietor || "", phone: legacy?.phone || "", email: legacy?.email || "",
        address: legacy?.address || "", gstin: legacy?.gstin || "", state: legacy?.state || "",
        bankName: legacy?.bankName || "", accountHolder: legacy?.accountHolder || "",
        accountNo: legacy?.accountNo || "", ifsc: legacy?.ifsc || "", terms: legacy?.terms || "Thank you for your business.",
        logoDataUrl: legacy?.logoDataUrl || "", createdAt: now, updatedAt: now,
      };
      await companies.insertOne(initial);
      rows = [cleanCompany(initial)];
    }
    res.json({ companies: rows, maxCompanies: MAX_COMPANIES });
  } catch (error) {
    console.error("Companies list error:", error);
    res.status(500).json({ error: "Could not load companies." });
  }
});

router.post("/", async (req, res) => {
  try {
    const db = await getDb();
    const companies = db.collection("companies");
    const count = await companies.countDocuments({ userId: req.userId });
    if (count >= MAX_COMPANIES) return res.status(403).json({ error: "Your plan allows up to 5 company profiles. Subscription limits will be enforced when plans are connected." });
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Company name is required." });
    const now = new Date().toISOString();
    const company = {
      id: uuid(), userId: req.userId, name,
      proprietor: String(req.body?.proprietor || ""), phone: String(req.body?.phone || ""),
      email: String(req.body?.email || ""), address: String(req.body?.address || ""),
      gstin: String(req.body?.gstin || ""), state: String(req.body?.state || ""),
      createdAt: now, updatedAt: now,
    };
    await companies.insertOne(company);
    res.status(201).json({ company: cleanCompany(company) });
  } catch (error) {
    console.error("Company create error:", error);
    res.status(500).json({ error: "Could not create company." });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const db = await getDb();
    const companies = db.collection("companies");
    const update = {};
    for (const key of ["name", "proprietor", "phone", "email", "address", "gstin", "state", "bankName", "accountHolder", "accountNo", "ifsc", "terms", "logoDataUrl"]) {
      if (req.body?.[key] !== undefined) update[key] = key === "name" ? String(req.body[key]).trim() : String(req.body[key] ?? "");
    }
    if (update.name !== undefined && !update.name) return res.status(400).json({ error: "Company name is required." });
    update.updatedAt = new Date().toISOString();
    const result = await companies.findOneAndUpdate({ id: req.params.id, userId: req.userId }, { $set: update }, { returnDocument: "after", projection: { _id: 0, userId: 0 } });
    if (!result) return res.status(404).json({ error: "Company not found." });
    res.json({ company: result });
  } catch (error) {
    console.error("Company update error:", error);
    res.status(500).json({ error: "Could not update company." });
  }
});

export default router;
