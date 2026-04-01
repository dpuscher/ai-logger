import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_DIR = path.join(os.homedir(), ".ai-logger");
export const cookiesPath = path.join(CONFIG_DIR, "cookies.json");

// Ensure the config directory exists
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

const readConfigFile = (): Record<string, string> => {
  const configPath = path.join(CONFIG_DIR, "config.json");
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, string>;
    }
  } catch {
    // ignore parse errors
  }
  return {};
};

// Returns config with env vars as highest-priority overrides for CI/backward compat.
// Reads config file fresh on each call so changes from the settings wizard are picked up.
export const getConfig = () => {
  const file = readConfigFile();
  return {
    apiKey: process.env.OPENROUTER_API_KEY ?? file.apiKey ?? "",
    apiBaseUrl: process.env.API_BASE_URL ?? file.apiBaseUrl ?? "https://openrouter.ai/api/v1",
    model: process.env.MODEL ?? file.model ?? "",
    geocachingUsername: process.env.GEOCACHING_USERNAME ?? file.geocachingUsername ?? "",
    geocachingPassword: process.env.GEOCACHING_PASSWORD ?? file.geocachingPassword ?? "",
  };
};
