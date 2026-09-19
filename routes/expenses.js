import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getDb } from "../db.js";

const router = Router();
async function col(){ return (await getDb()).collection("expenses"); }

router.get("/", async (req,res)=>{
  try{
    const items=await (await col()).find({userId:req.userId},{projection:{_id:0}}).sort({date:-1,createdAt:-1}).toArray();
    res.json(items);
  }catch(e){res.status(500).json({error:e.message});}
});
router.post("/", async (req,res)=>{
  try{
    const amount=Number(req.body?.amount);
    if(!Number.isFinite(amount)||amount<=0) return res.status(400).json({error:"Valid expense amount is required"});
    const item={id:uuid(),userId:req.userId,date:String(req.body?.date||new Date().toISOString().slice(0,10)),category:String(req.body?.category||"Other"),description:String(req.body?.description||""),amount,notes:String(req.body?.notes||""),createdAt:new Date().toISOString()};
    await (await col()).insertOne(item);
    const {_id,...clean}=item; res.status(201).json(clean);
  }catch(e){res.status(500).json({error:e.message});}
});
router.put("/:id", async(req,res)=>{
  try{
    const update={...req.body}; delete update._id; delete update.userId; delete update.id;
    if(update.amount!==undefined) update.amount=Number(update.amount);
    const r=await (await col()).findOneAndUpdate({id:req.params.id,userId:req.userId},{$set:update},{returnDocument:"after",projection:{_id:0}});
    if(!r)return res.status(404).json({error:"Expense not found"}); res.json(r);
  }catch(e){res.status(500).json({error:e.message});}
});
router.delete("/:id",async(req,res)=>{
  try{const r=await (await col()).deleteOne({id:req.params.id,userId:req.userId});if(!r.deletedCount)return res.status(404).json({error:"Expense not found"});res.status(204).end();}
  catch(e){res.status(500).json({error:e.message});}
});
export default router;