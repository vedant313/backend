import { Router } from "express";
import { getBusinessCollection } from "../db.js";

const router = Router();

// GET business profile
router.get("/", async (req, res) => {
  try {
    const col = await getBusinessCollection();
    const business = await col.findOne({ _key: "profile" }, { projection: { _id: 0, _key: 0 } });
    res.json(business);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PUT (update) business profile
router.put("/", async (req, res) => {
  try {
    const col = await getBusinessCollection();
    const update = { ...req.body };
    delete update._id;
    delete update._key;
    await col.updateOne({ _key: "profile" }, { $set: update }, { upsert: true });
    const business = await col.findOne({ _key: "profile" }, { projection: { _id: 0, _key: 0 } });
    res.json(business);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
