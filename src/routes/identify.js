const express = require("express");
const router = express.Router();
const { identify } = require("../services/identityService");

router.post("/", async (req, res) => {
  try {
    const result = await identify(req.body);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).send("Error");
  }
});

module.exports = router;
