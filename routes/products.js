import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getDb } from "../db.js";
const router=Router();
async function col(){ return (await getDb()).collection("products"); }
router.get("/",async(req,res)=>{try{res.json(await (await col()).find({userId:req.userId},{projection:{_id:0}}).sort({name:1}).toArray())}catch(e){res.status(500).json({error:e.message})}});
router.post("/",async(req,res)=>{try{const name=String(req.body?.name||"").trim();if(!name)return res.status(400).json({error:"Product name is required"});const item={id:uuid(),userId:req.userId,name,hsn:String(req.body?.hsn||""),unit:String(req.body?.unit||"pcs"),rate:Number(req.body?.rate)||0,gstPct:Number(req.body?.gstPct)||0,stock:Number(req.body?.stock)||0,createdAt:new Date().toISOString()};await (await col()).insertOne(item);const {_id,...clean}=item;res.status(201).json(clean)}catch(e){res.status(500).json({error:e.message})}});
router.put("/:id",async(req,res)=>{try{const c=await col();const update={...req.body};delete update._id;delete update.userId;const r=await c.findOneAndUpdate({id:req.params.id,userId:req.userId},{$set:update},{returnDocument:"after",projection:{_id:0}});if(!r)return res.status(404).json({error:"Product not found"});res.json(r)}catch(e){res.status(500).json({error:e.message})}});
router.delete("/:id",async(req,res)=>{const r=await (await col()).deleteOne({id:req.params.id,userId:req.userId});if(!r.deletedCount)return res.status(404).json({error:"Product not found"});res.status(204).end()});
export default router;