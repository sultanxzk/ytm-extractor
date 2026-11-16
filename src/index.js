import express from "express";
import { spawn } from "node:child_process";

const app = express();
const port = Number(process.env.PORT || 8080);
const ytDlp = process.env.YT_DLP_PATH || "yt-dlp";
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Headers", "Range,Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length,Content-Range,Accept-Ranges");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function parseInput(req) {
  const raw = String(req.query.id || req.query.videoId || req.query.url || "").trim();
  if (VIDEO_ID.test(raw)) return `https://www.youtube.com/watch?v=${raw}`;
  try {
    const url = new URL(raw);
    if (!["youtube.com", "www.youtube.com", "music.youtube.com", "youtu.be"].includes(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "ytm-extractor" }));

app.get("/stream", (req, res) => {
  const url = parseInput(req);
  if (!url) return res.status(400).json({ error: "Informe videoId ou URL válida do YouTube." });

  const args = ["--no-playlist", "--no-warnings", "--quiet", "--format", "bestaudio[ext=m4a]/bestaudio/best", "--output", "-", url];
  if (req.headers.range) args.splice(1, 0, "--http-chunk-size", "10M");
  const child = spawn(ytDlp, args, { stdio: ["ignore", "pipe", "pipe"] });
  let started = false;
  let error = "";
  const timer = setTimeout(() => child.kill("SIGTERM"), 120000);

  res.statusCode = 200;
  res.setHeader("Content-Type", "audio/mp4");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-store");
  child.stdout.on("data", (chunk) => { started = true; res.write(chunk); });
  child.stderr.on("data", (chunk) => { error += chunk.toString().slice(-2000); });
  child.on("error", (err) => { clearTimeout(timer); if (!started && !res.headersSent) res.status(500).json({ error: err.message }); else res.end(); });
  child.on("close", (code) => { clearTimeout(timer); if (!started && !res.headersSent) res.status(502).json({ error: "yt-dlp falhou", details: error }); else res.end(); });
  req.on("close", () => { clearTimeout(timer); if (!child.killed) child.kill("SIGTERM"); });
});

app.listen(port, "0.0.0.0", () => console.log(`ytm extractor listening on ${port}`));
