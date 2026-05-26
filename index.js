const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3000",
  "https://my-spendora-e241a7.netlify.app",
  "https://my-spendora-f1d7e3.netlify.app", 
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  methods: ["GET", "POST", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type"],
}));
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jbcozto.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let isConnected = false;
async function connectDB() {
  if (isConnected) return;
  await client.connect();
  await client.db("admin").command({ ping: 1 });
  console.log("✅ MongoDB Connected");
  isConnected = true;
}

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ✅ collection helper — always gets fresh ref after connect
function col() {
  return client.db("expenseTrackerDB").collection("expenses");
}

// ── Routes (all OUTSIDE run, all call connectDB first) ──────────────

app.get("/", (req, res) => {
  res.json({ message: "Expense Tracker Server Running ✅" });
});

app.get("/expenses/summary", asyncHandler(async (req, res) => {
  await connectDB();
  const [result] = await col().aggregate([
    {
      $group: {
        _id: null,
        totalIncome:  { $sum: { $cond: [{ $eq: ["$type", "income"]  }, "$amt", 0] } },
        totalExpense: { $sum: { $cond: [{ $eq: ["$type", "expense"] }, "$amt", 0] } },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0, totalIncome: 1, totalExpense: 1, count: 1,
        balance: { $subtract: ["$totalIncome", "$totalExpense"] },
      },
    },
  ]).toArray();
  res.json(result || { totalIncome: 0, totalExpense: 0, balance: 0, count: 0 });
}));

app.get("/expenses/summary/monthly", asyncHandler(async (req, res) => {
  await connectDB();
  const { uid, email } = req.query;
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const filter = { createdAt: { $gte: start } };
  if (uid) filter.uid = uid;
  else if (email) filter.email = email;
  const data = await col().find(filter).toArray();
  let totalIncome = 0, totalExpense = 0;
  data.forEach(tx => {
    if (tx.type === "income") totalIncome += Number(tx.amt);
    else totalExpense += Number(tx.amt);
  });
  res.json({ totalIncome, totalExpense, count: data.length });
}));

app.get("/expenses/recent", asyncHandler(async (req, res) => {
  await connectDB();
  const { limit = 5, uid, email } = req.query;
  const filter = {};
  if (uid) filter.uid = uid;
  else if (email) filter.email = email;
  const data = await col().find(filter).sort({ createdAt: -1 }).limit(Number(limit)).toArray();
  res.json(data);
}));

app.get("/expenses", asyncHandler(async (req, res) => {
  await connectDB();
  const { type, cat, search, uid, email } = req.query;
  const filter = {};
  if (uid) filter.uid = uid;
  else if (email) filter.email = email;
  if (type && type !== "All") filter.type = type;
  if (cat  && cat  !== "All") filter.cat  = cat;
  if (search) filter.desc = { $regex: search, $options: "i" };
  const result = await col().find(filter).sort({ createdAt: -1 }).toArray();
  res.json(result);
}));

app.post("/expenses", asyncHandler(async (req, res) => {
  await connectDB();
  const { desc, amt, type, cat, date, uid, email } = req.body;
  if (!desc || typeof desc !== "string" || !desc.trim())
    return res.status(400).json({ error: "desc is required" });
  if (!amt || isNaN(Number(amt)) || Number(amt) <= 0)
    return res.status(400).json({ error: "amt must be a positive number" });
  if (!["expense", "income"].includes(type))
    return res.status(400).json({ error: "type must be 'expense' or 'income'" });
  if (!cat)  return res.status(400).json({ error: "cat is required" });
  if (!date) return res.status(400).json({ error: "date is required" });
  const doc = {
    desc: desc.trim(), amt: parseFloat(amt), type, cat, date,
    uid: uid || null, email: email || null, createdAt: new Date(),
  };
  const result = await col().insertOne(doc);
  res.status(201).json({ ...doc, _id: result.insertedId });
}));

app.patch("/expenses/:id", asyncHandler(async (req, res) => {
  await connectDB();
  const { id } = req.params;
  if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
  const { desc, amt, type, cat, date } = req.body;
  const updates = {};
  if (desc !== undefined) updates.desc = desc.trim();
  if (amt  !== undefined) updates.amt  = parseFloat(amt);
  if (type !== undefined) updates.type = type;
  if (cat  !== undefined) updates.cat  = cat;
  if (date !== undefined) updates.date = date;
  if (Object.keys(updates).length === 0)
    return res.status(400).json({ error: "No fields to update" });
  const updatedDoc = await col().findOneAndUpdate(
    { _id: new ObjectId(id) }, { $set: updates }, { returnDocument: "after" }
  );
  if (!updatedDoc) return res.status(404).json({ error: "Expense not found" });
  res.json(updatedDoc);
}));

app.delete("/expenses/:id", asyncHandler(async (req, res) => {
  await connectDB();
  const { id } = req.params;
  if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
  const result = await col().deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) return res.status(404).json({ error: "Expense not found" });
  res.json({ success: true, deletedId: id });
}));

app.use((err, req, res, _next) => {
  console.error("❌ Error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});

module.exports = app;