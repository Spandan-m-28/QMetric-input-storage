console.log("✅ googleAuth routes loaded");

const express = require("express");
const { google } = require("googleapis");

const router = express.Router();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// STEP 1: Start OAuth
router.get("/google", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/drive.file"],
  });

  res.redirect(url);
});

// STEP 2: Google redirects here
router.get("/google/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send("No code");

    const { tokens } = await oauth2Client.getToken(code);

    // 🔑 THIS IS WHAT YOU NEED
    console.log("REFRESH TOKEN:", tokens.refresh_token);

    res.send("Google Drive connected. You can close this tab.");
  } catch (err) {
    console.error(err);
    res.status(500).send("OAuth failed");
  }
});

module.exports = router;
