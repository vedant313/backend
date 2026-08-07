import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, "data", "db.json");

const DEFAULT_DATA = {
  business: {
    name: "My Business",
    proprietor: "",
    phone: "",
    email: "",
    address: "",
    gstin: "",
    state: "",
    bankName: "",
    accountHolder: "",
    accountNo: "",
    ifsc: "",
    terms: "Thank you for your business.",
    logoDataUrl: "",
  },
  documents: [], // invoices + estimates
  payments: [],
};

function ensureDb() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
  }
}

export function readDb() {
  ensureDb();
  const raw = fs.readFileSync(DB_FILE, "utf-8");
  try {
    return JSON.parse(raw);
  } catch {
    return DEFAULT_DATA;
  }
}

export function writeDb(data) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}
