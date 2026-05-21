const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

/* ── Middleware ── */
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type"],
  }),
);
app.use(express.json());

/* ── MongoDB URI ── */
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jbcozto.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

/* ── Global error handler ── */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

async function run() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("✅ MongoDB Connected Successfully");

    const expensesCollection = client
      .db("expenseTrackerDB")
      .collection("expenses");

    /* ── TEST ROUTE ── */
    app.get("/", (req, res) => {
      res.json({ message: "Expense Tracker Server Running ✅" });
    });

    /* ─────────────────────────────────────────────
       GET /expenses
       Query params:
         - type: "expense" | "income"
         - cat: category name
         - search: text search on desc
       ───────────────────────────────────────────── */
    app.get(
      "/expenses",
      asyncHandler(async (req, res) => {
        const { type, cat, search } = req.query;

        const filter = {};
        if (type && type !== "All") filter.type = type;
        if (cat && cat !== "All") filter.cat = cat;
        if (search) filter.desc = { $regex: search, $options: "i" };

        const result = await expensesCollection
          .find(filter)
          .sort({ createdAt: -1 })
          .toArray();

        res.json(result);
      }),
    );

    /* ─────────────────────────────────────────────
       POST /expenses
       Body: { desc, amt, type, cat, date }
       ───────────────────────────────────────────── */
    app.post(
      "/expenses",
      asyncHandler(async (req, res) => {
        const { desc, amt, type, cat, date } = req.body;

        /* validation */
        if (!desc || typeof desc !== "string" || !desc.trim())
          return res.status(400).json({ error: "desc is required" });
        if (!amt || isNaN(Number(amt)) || Number(amt) <= 0)
          return res
            .status(400)
            .json({ error: "amt must be a positive number" });
        if (!["expense", "income"].includes(type))
          return res
            .status(400)
            .json({ error: "type must be 'expense' or 'income'" });
        if (!cat) return res.status(400).json({ error: "cat is required" });
        if (!date) return res.status(400).json({ error: "date is required" });

        const doc = {
          desc: desc.trim(),
          amt: parseFloat(amt),
          type,
          cat,
          date,
          createdAt: new Date(),
        };

        const result = await expensesCollection.insertOne(doc);

        /* return the full inserted document */
        res.status(201).json({ ...doc, _id: result.insertedId });
      }),
    );

    /* ─────────────────────────────────────────────
       PATCH /expenses/:id
       Body: partial { desc, amt, type, cat, date }
       ───────────────────────────────────────────── */
    app.patch(
      "/expenses/:id",
      asyncHandler(async (req, res) => {
        const { id } = req.params;
        if (!ObjectId.isValid(id))
          return res.status(400).json({ error: "Invalid id" });

        const { desc, amt, type, cat, date } = req.body;
        const updates = {};
        if (desc !== undefined) updates.desc = desc.trim();
        if (amt !== undefined) updates.amt = parseFloat(amt);
        if (type !== undefined) updates.type = type;
        if (cat !== undefined) updates.cat = cat;
        if (date !== undefined) updates.date = date;

        if (Object.keys(updates).length === 0)
          return res.status(400).json({ error: "No fields to update" });

        const result = await expensesCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: updates },
          { returnDocument: "after" },
        );

        if (!result?.value) {
          return res.status(404).json({ error: "Expense not found" });
        }

        res.json(result.value);
      }),
    );

    /* ─────────────────────────────────────────────
       DELETE /expenses/:id
       ───────────────────────────────────────────── */
    app.delete(
      "/expenses/:id",
      asyncHandler(async (req, res) => {
        const { id } = req.params;
        if (!ObjectId.isValid(id))
          return res.status(400).json({ error: "Invalid id" });

        const result = await expensesCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0)
          return res.status(404).json({ error: "Expense not found" });

        res.json({ success: true, deletedId: id });
      }),
    );

    /* ─────────────────────────────────────────────
       GET /expenses/summary
       Returns totals: income, expense, balance
       ───────────────────────────────────────────── */
    app.get(
      "/expenses/summary",
      asyncHandler(async (req, res) => {
        const [result] = await expensesCollection
          .aggregate([
            {
              $group: {
                _id: null,
                totalIncome: {
                  $sum: { $cond: [{ $eq: ["$type", "income"] }, "$amt", 0] },
                },
                totalExpense: {
                  $sum: { $cond: [{ $eq: ["$type", "expense"] }, "$amt", 0] },
                },
                count: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                totalIncome: 1,
                totalExpense: 1,
                balance: { $subtract: ["$totalIncome", "$totalExpense"] },
                count: 1,
              },
            },
          ])
          .toArray();

        res.json(
          result || { totalIncome: 0, totalExpense: 0, balance: 0, count: 0 },
        );
      }),
    );

    // OverView Get---------
    app.get(
      "/expenses/recent",
      asyncHandler(async (req, res) => {
        const { limit = 5, email } = req.query;

        const filter = {};
        if (email) filter.email = email;

        const data = await expensesCollection
          .find(filter)
          .sort({ createdAt: -1 })
          .limit(Number(limit))
          .toArray();

        res.json(data);
      }),
    );

    //Overview monthly---------
    app.get(
      "/expenses/summary/monthly",
      asyncHandler(async (req, res) => {
        const { email } = req.query;

        const start = new Date();
        start.setDate(1);
        start.setHours(0, 0, 0, 0);

        const filter = {
          createdAt: { $gte: start },
        };

        if (email) filter.email = email;

        const data = await expensesCollection.find(filter).toArray();

        let totalIncome = 0;
        let totalExpense = 0;

        data.forEach((t) => {
          if (t.type === "income") totalIncome += Number(t.amt);
          else totalExpense += Number(t.amt);
        });

        res.json({
          totalIncome,
          totalExpense,
          count: data.length,
        });
      }),
    );

    /* ── Global error middleware ── */
    app.use((err, req, res, _next) => {
      console.error("❌ Error:", err.message);
      res.status(500).json({ error: "Internal server error" });
    });
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    process.exit(1);
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
