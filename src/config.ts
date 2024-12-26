import "dotenv/config.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const GC_USERNAME = process.env.GEOCACHING_USERNAME || "";
export const GC_PASSWORD = process.env.GEOCACHING_PASSWORD || "";
export const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

if (!GC_USERNAME || !GC_PASSWORD || !OPENAI_KEY) {
  console.error(
    "❌ ERROR: Missing required env variables (GEOCACHING_USERNAME, GEOCACHING_PASSWORD, OPENAI_API_KEY) in .env",
  );
  process.exit(1);
}

// Define the new cookies directory
const cookiesDir = path.join(os.homedir(), ".ai-cache-log");
export const cookiesPath = path.join(cookiesDir, "cookies.json");

// Ensure the cookies directory exists
if (!fs.existsSync(cookiesDir)) {
  fs.mkdirSync(cookiesDir, { recursive: true });
}
