import "dotenv/config.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const API_KEY = process.env.OPENROUTER_API_KEY || "";

if (!API_KEY) {
  console.error(
    "❌ ERROR: Missing required env variable OPENROUTER_API_KEY in .env",
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
