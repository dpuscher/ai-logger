import "dotenv/config.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GC_USERNAME = process.env.GEOCACHING_USERNAME || "";
export const GC_PASSWORD = process.env.GEOCACHING_PASSWORD || "";
export const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

if (!GC_USERNAME || !GC_PASSWORD || !OPENAI_KEY) {
  console.error(
    "❌ ERROR: Missing required env variables (GEOCACHING_USERNAME, GEOCACHING_PASSWORD, OPENAI_API_KEY) in .env",
  );
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Where cookies get stored
export const cookiesPath = path.join(__dirname, "..", "cookies.json");
