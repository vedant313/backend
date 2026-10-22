import { Router } from "express";
import { v4 as uuid } from "uuid";
import { getDb } from "../db.js";
const router = Router();
const allowed = new Set(["fixedAssets","paymentReminders","serviceReminders","partySettings","itemCustomFields","transactionMessages","orders","challans","ewayBills","accountingEntries"]);
const now = () => new Date().toISOString();
router.get("/:kind", async (req,res) => {
 try { if(!allowed.has(req.params.kind)) return res.status(400).json({error:"Unsupported feature."}); const d=await getDb(); const records=await d.collection("feature_"+req.params.kind).find({userId:req.userId},{projection:{_id:0,userId:0}}).sort({updatedAt:-1}).limit(500).toArray(); res.json({records}); }
 catch(e){console.error(e);res.status(500).json({error:"Could not load feature records."});}
});
router.post("/:kind", async (req,res) => {
 try { if(!allowed.has(req.params.kind)) return res.status(400).json({error:"Unsupported feature."}); const record={...(req.body||{}),id:uuid(),userId:req.userId,createdAt:now(),updatedAt:now()}; delete record._id; const d=await getDb(); await d.collection("feature_"+req.params.kind).insertOne(record); const {_id,userId,...safe}=record; res.status(201).json({record:safe}); }
 catch(e){console.error(e);res.status(500).json({error:"Could not save feature record."});}
});
router.patch("/:kind/:id", async (req,res) => {
 try { if(!allowed.has(req.params.kind)) return res.status(400).json({error:"Unsupported feature."}); const patch={...(req.body||{}),updatedAt:now()}; for(const k of ["_id","id","userId","createdAt"]) delete patch[k]; const d=await getDb(); const result=await d.collection("feature_"+req.params.kind).findOneAndUpdate({id:req.params.id,userId:req.userId},{$set:patch},{returnDocument:"after",projection:{_id:0,userId:0}}); if(!result)return res.status(404).json({error:"Record not found."}); res.json({record:result}); }
 catch(e){console.error(e);res.status(500).json({error:"Could not update record."});}
});
router.get("/reports/profit-loss/summary", async (req,res) => {
 try { const d=await getDb(); const invoices=await d.collection("documents").find({userId:req.userId,type:"invoice"}).toArray(); const expenses=await d.collection("expenses").find({userId:req.userId}).toArray(); const revenue=invoices.reduce((s,x)=>s+Number(x.grandTotal??x.total??x.amount??0),0); const expenseTotal=expenses.reduce((s,x)=>s+Number(x.amount||0),0); res.json({revenue,expenses:expenseTotal,estimatedProfit:revenue-expenseTotal,note:"Operational estimate only; validate statutory accounts and tax treatment with an accountant."}); }
 catch(e){console.error(e);res.status(500).json({error:"Could not build report."});}
});
export default router;
