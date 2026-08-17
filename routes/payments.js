import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getPaymentsCollection } from "../db.js";

const router = Router();

// GET all payments (only this user's)
router.get("/", async (req, res) => {
  try {
    const col = await getPaymentsCollection();
    const payments = await col.find({ userId: req.userId }, { projection: { _id: 0 } }).toArray();
    res.json(payments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST create a new payment
router.post("/", async (req, res) => {
  try {
    const col = await getPaymentsCollection();
    const payment = { id: uuid(), ...req.body, userId: req.userId };
    await col.insertOne({ ...payment });
    const { _id, ...clean } = payment;
    res.status(201).json(clean);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PUT update an existing payment
router.put("/:id", async (req, res) => {
  try {
    const col = await getPaymentsCollection();
    const update = { ...req.body, id: req.params.id, userId: req.userId };
    delete update._id;
    const result = await col.findOneAndUpdate(
      { id: req.params.id, userId: req.userId },
      { $set: update },
      { returnDocument: "after", projection: { _id: 0 } }
    );
    if (!result) return res.status(404).json({ error: "Payment not found" });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE a payment
router.delete("/:id", async (req, res) => {
  try {
    const col = await getPaymentsCollection();
    const result = await col.deleteOne({ id: req.params.id, userId: req.userId });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Payment not found" });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
