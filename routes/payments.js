import { Router } from "express";
import { v4 as uuid } from "uuid";
import { readDb, writeDb } from "../db.js";

const router = Router();

// GET all payments
router.get("/", (req, res) => {
  const db = readDb();
  res.json(db.payments);
});

// POST create a new payment
router.post("/", (req, res) => {
  const db = readDb();
  const payment = { id: uuid(), ...req.body };
  db.payments.push(payment);
  writeDb(db);
  res.status(201).json(payment);
});

// PUT update an existing payment
router.put("/:id", (req, res) => {
  const db = readDb();
  const idx = db.payments.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Payment not found" });
  db.payments[idx] = { ...db.payments[idx], ...req.body, id: req.params.id };
  writeDb(db);
  res.json(db.payments[idx]);
});

// DELETE a payment
router.delete("/:id", (req, res) => {
  const db = readDb();
  const before = db.payments.length;
  db.payments = db.payments.filter((p) => p.id !== req.params.id);
  if (db.payments.length === before) return res.status(404).json({ error: "Payment not found" });
  writeDb(db);
  res.status(204).end();
});

export default router;
