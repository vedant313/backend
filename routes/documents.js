import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getDocumentsCollection } from "../db.js";

const router = Router();

// GET /api/documents?type=invoice|estimate  (only this user's documents)
router.get("/", async (req, res) => {
  try {
    const col = await getDocumentsCollection();
    const filter = { userId: req.userId, ...(req.query.type ? { type: req.query.type } : {}) };
    const docs = await col.find(filter, { projection: { _id: 0 } }).toArray();
    res.json(docs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET one document
router.get("/:id", async (req, res) => {
  try {
    const col = await getDocumentsCollection();
    const doc = await col.findOne({ id: req.params.id, userId: req.userId }, { projection: { _id: 0 } });
    if (!doc) return res.status(404).json({ error: "Document not found" });
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST create a new invoice/estimate
router.post("/", async (req, res) => {
  try {
    const col = await getDocumentsCollection();
    const doc = { id: uuid(), ...req.body, userId: req.userId };
    await col.insertOne({ ...doc });
    const { _id, ...clean } = doc;
    res.status(201).json(clean);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PUT update an existing invoice/estimate
router.put("/:id", async (req, res) => {
  try {
    const col = await getDocumentsCollection();
    const update = { ...req.body, id: req.params.id, userId: req.userId };
    delete update._id;
    const result = await col.findOneAndUpdate(
      { id: req.params.id, userId: req.userId },
      { $set: update },
      { returnDocument: "after", projection: { _id: 0 } }
    );
    if (!result) return res.status(404).json({ error: "Document not found" });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE an invoice/estimate
router.delete("/:id", async (req, res) => {
  try {
    const col = await getDocumentsCollection();
    const result = await col.deleteOne({ id: req.params.id, userId: req.userId });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Document not found" });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
