const express = require("express");
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const {
  AI_MODEL_ID,
  SYSTEM_PROMPT,
  MAX_OUTPUT_TOKENS,
  TEMPERATURE,
  MAX_HISTORY_MESSAGES,
  MAX_REQUEST_CHARS,
} = require("./ai-config");

const router = express.Router();
const DATA_DIR = path.join(__dirname, "data");
const HISTORY_FILE = path.join(DATA_DIR, "chat_histories.json");

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({}), "utf8");
  }
}

function getUserHistory(userId) {
  try {
    ensureDataFile();
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    return Array.isArray(data[userId]) ? data[userId] : [];
  } catch (err) {
    console.error("Error reading user history:", err);
    return [];
  }
}

function saveUserHistory(userId, messages) {
  try {
    ensureDataFile();
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    data[userId] = Array.isArray(messages) ? messages : [];
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (err) {
    console.error("Error saving user history:", err);
    return false;
  }
}

function deleteUserHistory(userId) {
  try {
    ensureDataFile();
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    delete data[userId];
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (err) {
    console.error("Error deleting user history:", err);
    return false;
  }
}

router.get("/history/:userId", (req, res) => {
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }
  const history = getUserHistory(userId);
  res.json(history);
});

router.post("/history/:userId", (req, res) => {
  const { userId } = req.params;
  const { messages } = req.body;
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }
  saveUserHistory(userId, messages);
  res.json({ success: true });
});

router.delete("/history/:userId", (req, res) => {
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }
  deleteUserHistory(userId);
  res.json({ success: true });
});

router.post("/chat", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey || apiKey === "your_gemini_key_here") {
    console.error("GEMINI_API_KEY is not set");
    const guideText =
      "⚠️ **Gemini API Key Needed (100% Free)**\n\n" +
      "Google Gemini provides a generous free tier with no credit card required:\n\n" +
      "1. Get your free key at **[Google AI Studio](https://aistudio.google.com/app/apikey)** (takes 30 seconds).\n" +
      "2. Open `Backend/.env` and paste your key:\n" +
      "```env\n" +
      "GEMINI_API_KEY=AIzaSy...\n" +
      "```\n" +
      "3. Save the `.env` file — nodemon will reload automatically!\n\n" +
      "> **Note**: Code blocks generated will have a **▶ Run** button ";

    res.write(`data: ${JSON.stringify({ text: guideText })}\n\n`);
    res.write("data: [DONE]\n\n");
    return res.end();
  }

  const raw = JSON.stringify(req.body);
  if (raw.length > MAX_REQUEST_CHARS) {
    res.write(`data: ${JSON.stringify({ error: "Request payload too large." })}\n\n`);
    return res.end();
  }

  const { messages, userId } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    res.write(`data: ${JSON.stringify({ error: "No messages provided." })}\n\n`);
    return res.end();
  }

  const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);

  const geminiContents = [];
  for (const m of trimmed) {
    const role = m.role === "assistant" ? "model" : "user";
    const text =
      typeof m.content === "string"
        ? m.content
        : (m.parts ?? [])
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("");

    if (!text || !text.trim()) continue;

    const prev = geminiContents[geminiContents.length - 1];
    if (prev && prev.role === role) {
      prev.parts[0].text += `\n\n${text}`;
    } else {
      geminiContents.push({
        role,
        parts: [{ text }],
      });
    }
  }

  while (geminiContents.length > 0 && geminiContents[0].role !== "user") {
    geminiContents.shift();
  }

  if (geminiContents.length === 0) {
    res.write(`data: ${JSON.stringify({ error: "Empty message content." })}\n\n`);
    return res.end();
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: AI_MODEL_ID,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: TEMPERATURE,
      },
    });

    const result = await model.generateContentStream({
      contents: geminiContents,
    });

    let fullGeneratedText = "";
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        fullGeneratedText += chunkText;
        res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
      }
    }

    if (userId && fullGeneratedText) {
      const userHistory = getUserHistory(userId);
      const lastUserMsg = messages[messages.length - 1];
      const assistantMsg = {
        id: Date.now().toString(),
        role: "assistant",
        content: fullGeneratedText,
      };
      saveUserHistory(userId, [...userHistory, lastUserMsg, assistantMsg]);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    if (res.writableEnded) return;

    console.error("Gemini AI stream error:", error);
    const msg =
      error.message || "Failed to generate AI response. Please check your Gemini API key and quota.";
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.end();
  }
});

module.exports = router;
