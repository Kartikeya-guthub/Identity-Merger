if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}
const express = require("express");
const identifyRouter = require("./routes/identify");
const migrate = require("./db/migrate");

const app = express();
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Routes
app.use("/identify", identifyRouter);

const PORT = process.env.PORT || 3000;

migrate()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
