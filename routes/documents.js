import { Router } from "express";
import { v4 as uuid } from "uuid";
import { readDb, writeDb } from "../db.js";

const router = Router();

// GET /api/documents?type=invoice|estimate
router.get("/", (req, res) => {
  const db = readDb();
  const { type } = req.query;
  const docs = type ? db.documents.filter((d) => d.type === type) : db.documents;
  res.json(docs);
});

// GET one document
router.get("/:id", (req, res) => {
  const db = readDb();
  const doc = db.documents.find((d) => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  res.json(doc);
});

// POST create a new invoice/estimate
router.post("/", (req, res) => {
  const db = readDb();
  const doc = { id: uuid(), ...req.body };
  db.documents.push(doc);
  writeDb(db);
  res.status(201).json(doc);
});

// PUT update an existing invoice/estimate
router.put("/:id", (req, res) => {
  const db = readDb();
  const idx = db.documents.findIndex((d) => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Document not found" });
  db.documents[idx] = { ...db.documents[idx], ...req.body, id: req.params.id };
  writeDb(db);
  res.json(db.documents[idx]);
});

// DELETE an invoice/estimate
router.delete("/:id", (req, res) => {
  const db = readDb();
  const before = db.documents.length;
  db.documents = db.documents.filter((d) => d.id !== req.params.id);
  if (db.documents.length === before) return res.status(404).json({ error: "Document not found" });
  writeDb(db);
  res.status(204).end();
});

export default router;
