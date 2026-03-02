const express = require("express");
const router = express.Router();

// POST /identify — to be implemented in Phase 2
router.post("/", (req, res) => {
  res.status(501).json({ message: "Not implemented yet" });
});

module.exports = router;
