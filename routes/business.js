import { Router } from "express";
import { getBusinessCollection } from "../db.js";

const router = Router();

// GET business profile (for the signed-in user)
router.get("/", async (req, res) => {
  try {
    const col = await getBusinessCollection(req.userId);
    const business = await col.findOne({ userId: req.userId }, { projection: { _id: 0, userId: 0 } });
    res.json(business);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PUT (update) business profile (for the signed-in user)
router.put("/", async (req, res) => {
  try {
    const col = await getBusinessCollection(req.userId);
    const update = { ...req.body };
    delete update._id;
    delete update.userId;
    await col.updateOne({ userId: req.userId }, { $set: update }, { upsert: true });
    const business = await col.findOne({ userId: req.userId }, { projection: { _id: 0, userId: 0 } });
    res.json(business);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
