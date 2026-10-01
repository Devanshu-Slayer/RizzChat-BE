const express = require("express");

const router = express.Router();

const JUDGE0_BASE = "https://ce.judge0.com";

function judge0Headers() {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (process.env.JUDGE0_API_KEY) {
    headers["X-RapidAPI-Key"] = process.env.JUDGE0_API_KEY;
    headers["X-RapidAPI-Host"] = "judge0-ce.p.rapidapi.com";
  }
  return headers;
}

router.post("/run", async (req, res) => {
  const { source_code, language_id, stdin = "" } = req.body;

  if (!source_code || !language_id) {
    return res.status(400).json({ error: "source_code and language_id are required." });
  }

  try {
    const submitRes = await fetch(
      `${JUDGE0_BASE}/submissions?base64_encoded=false&wait=true`,
      {
        method: "POST",
        headers: judge0Headers(),
        body: JSON.stringify({
          source_code,
          language_id,
          stdin,
        }),
      }
    );

    if (!submitRes.ok) {
      const text = await submitRes.text();
      console.error("Judge0 submission error:", text);
      return res.status(502).json({ error: "Code execution service error.", detail: text });
    }

    const result = await submitRes.json();

    return res.json({
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      compile_output: result.compile_output ?? "",
      status: result.status,
      time: result.time,
      memory: result.memory,
    });
  } catch (err) {
    console.error("Judge route error:", err);
    return res.status(500).json({ error: "Failed to reach code execution service." });
  }
});

router.get("/languages", async (req, res) => {
  try {
    const langRes = await fetch(`${JUDGE0_BASE}/languages`, {
      headers: judge0Headers(),
    });

    if (!langRes.ok) {
      return res.status(502).json({ error: "Could not fetch language list." });
    }

    const all = await langRes.json();
    return res.json(all);
  } catch (err) {
    console.error("Languages route error:", err);
    return res.status(500).json({ error: "Failed to fetch languages." });
  }
});

module.exports = router;
