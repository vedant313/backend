import { Router } from "express";
import { readDb, writeDb } from "../db.js";

const router = Router();

// GET business profile
router.get("/", (req, res) => {
  const db = readDb();
  res.json(db.business);
});

// PUT (replace) business profile
router.put("/", (req, res) => {
  const db = readDb();
  db.business = { ...db.business, ...req.body };
  writeDb(db);
  res.json(db.business);
});

export default router;
