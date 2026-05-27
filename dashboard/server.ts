import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { resolve } from "../src/root.js";

const PORT = parseInt(process.env.PORT || "3333", 10);
const PUBLIC_DIR = resolve("dashboard", "public");

// ── JSONL / file readers ─────────────────────────────────────────

function parseJsonlContent(raw: string): unknown[] {
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter((v) => v !== null);
}

function readJsonl(filename: string): unknown[] {
  const logsDir = resolve("logs");
  const base = filename.replace(".jsonl", "");
  let entries: unknown[] = [];

  try {
    // Read rotated archives first (sorted chronologically)
    const files = fs.readdirSync(logsDir)
      .filter((f) => f.startsWith(base + ".") && f.endsWith(".jsonl") && f !== filename)
      .sort();
    for (const f of files) {
      entries.push(...parseJsonlContent(fs.readFileSync(path.join(logsDir, f), "utf-8")));
    }
  } catch { /* no logs dir yet */ }

  // Then read the current file
  try {
    entries.push(...parseJsonlContent(fs.readFileSync(path.join(logsDir, filename), "utf-8")));
  } catch { /* file doesn't exist yet */ }

  return entries;
}

function readTextFile(relativePath: string): string {
  try {
    return fs.readFileSync(resolve(relativePath), "utf-8");
  } catch {
    return "";
  }
}

// ── MIME types ───────────────────────────────────────────────────

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// ── Route handling ───────────────────────────────────────────────

function sendJson(res: http.ServerResponse, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function sendFile(res: http.ServerResponse, filePath: string): void {
  try {
    const ext = path.extname(filePath);
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": content.length,
    });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

function send404(res: http.ServerResponse): void {
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

// ── Server ───────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // API routes
  if (pathname === "/api/iterations") {
    return sendJson(res, readJsonl("iterations.jsonl"));
  }
  if (pathname === "/api/token-usage") {
    return sendJson(res, readJsonl("token-usage.jsonl"));
  }
  if (pathname === "/api/decisions") {
    return sendJson(res, readJsonl("decisions.jsonl"));
  }
  if (pathname === "/api/test-reports") {
    return sendJson(res, readJsonl("test-reports.jsonl"));
  }
  if (pathname === "/api/portfolio") {
    return sendJson(res, { content: readTextFile("portfolio/index.md") });
  }
  if (pathname === "/api/manifesto") {
    return sendJson(res, { content: readTextFile("identity/manifesto.md") });
  }
  if (pathname === "/api/journal") {
    return sendJson(res, { content: readTextFile("identity/journal.md") });
  }
  if (pathname === "/api/lineage") {
    try {
      const raw = fs.readFileSync(resolve("identity", "lineage.yml"), "utf-8");
      return sendJson(res, yaml.parse(raw));
    } catch {
      return sendJson(res, { nodes: [], edges: [], constellations: [], creative_dna: { top_motifs: [], technique_signatures: [], domain_affinities: [], unexplored_territory: [] }, updated_at: null });
    }
  }
  if (pathname === "/api/mood") {
    try {
      const raw = fs.readFileSync(resolve("identity", "mood.yml"), "utf-8");
      return sendJson(res, yaml.parse(raw));
    } catch {
      return sendJson(res, { axes: {}, dominant_mood: "not yet computed", creative_nudge: "", influences: [], iteration: 0 });
    }
  }
  if (pathname === "/api/dreams") {
    try {
      const raw = fs.readFileSync(resolve("identity", "dreams.yml"), "utf-8");
      return sendJson(res, yaml.parse(raw));
    } catch {
      return sendJson(res, { dreams: [], updated_at: null });
    }
  }

  // Static files
  if (pathname === "/" || pathname === "/index.html") {
    return sendFile(res, path.join(PUBLIC_DIR, "index.html"));
  }

  // Serve other static files from public/
  const staticPath = path.resolve(PUBLIC_DIR, pathname.slice(1));
  if (staticPath.startsWith(PUBLIC_DIR + path.sep) && fs.existsSync(staticPath)) {
    return sendFile(res, staticPath);
  }

  send404(res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  The Foundry — Observatory`);
  console.log(`  http://localhost:${PORT}\n`);
});
