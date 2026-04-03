import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";

const CONFIG_DIR = path.join(os.homedir(), ".ai-logger");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export interface AppConfig {
  provider: string;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  geocachingUsername?: string;
  geocachingPassword?: string;
  maxLogsToCollect: number;
}

export const PROVIDERS = [
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { name: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  { name: "Together AI", baseUrl: "https://api.together.xyz/v1" },
  { name: "Fireworks AI", baseUrl: "https://api.fireworks.ai/inference/v1" },
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { name: "Mistral AI", baseUrl: "https://api.mistral.ai/v1" },
  { name: "Ollama (local)", baseUrl: "http://localhost:11434/v1" },
  { name: "Custom", baseUrl: "" },
];

export const loadSettings = (): Partial<AppConfig> => {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as Partial<AppConfig>;
    }
  } catch {
    // ignore parse errors
  }
  return {};
};

export const saveSettings = (config: Partial<AppConfig>): void => {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const existing = loadSettings();
  const updated = { ...existing, ...config };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), "utf-8");
};

export const runSettingsWizard = async (): Promise<AppConfig> => {
  console.log(chalk.cyan("\n⚙️  Full Settings Setup\n"));

  const existing = loadSettings();

  const providerChoices = PROVIDERS.map(p => ({ name: p.name, value: p.name }));

  const { providerName } = await inquirer.prompt<{ providerName: string }>({
    type: "select",
    name: "providerName",
    message: "Select AI provider:",
    choices: providerChoices,
    default: existing.provider ?? "OpenRouter",
  });

  const selectedProvider = PROVIDERS.find(p => p.name === providerName);
  if (!selectedProvider) {
    throw new Error(`Provider ${providerName} not found`);
  }
  let apiBaseUrl = selectedProvider.baseUrl;

  if (providerName === "Custom") {
    const { customUrl } = await inquirer.prompt<{ customUrl: string }>({
      type: "input",
      name: "customUrl",
      message: "Enter API base URL:",
      default: existing.apiBaseUrl ?? "",
      validate: (val: string) => (val.trim() ? true : "URL is required"),
    });
    apiBaseUrl = customUrl.trim();
  }

  const { model } = await inquirer.prompt<{ model: string }>({
    type: "input",
    name: "model",
    message: "Enter model name:",
    default: existing.model ?? "",
    validate: (val: string) => (val.trim() ? true : "Model name is required"),
  });

  let apiKey = "";
  if (providerName !== "Ollama (local)") {
    const { key } = await inquirer.prompt<{ key: string }>({
      type: "password",
      name: "key",
      message: "Enter API key:",
      mask: "*",
      default: existing.apiKey ?? "",
    });
    apiKey = key;
  }

  const { geocachingUsername } = await inquirer.prompt<{ geocachingUsername: string }>({
    type: "input",
    name: "geocachingUsername",
    message: "Geocaching username (optional, for auto-login):",
    default: existing.geocachingUsername ?? "",
  });

  const { geocachingPassword } = await inquirer.prompt<{ geocachingPassword: string }>({
    type: "password",
    name: "geocachingPassword",
    message: "Geocaching password (optional, for auto-login):",
    mask: "*",
    default: existing.geocachingPassword ?? "",
  });

  const { maxLogsToCollect } = await inquirer.prompt<{ maxLogsToCollect: number }>({
    type: "number",
    name: "maxLogsToCollect",
    message: "Maximum number of logs to collect for context:",
    default: existing.maxLogsToCollect ?? 50,
  });

  const config: AppConfig = {
    provider: providerName,
    apiBaseUrl,
    apiKey,
    model: model.trim(),
    geocachingUsername: geocachingUsername || "",
    geocachingPassword: geocachingPassword || "",
    maxLogsToCollect: maxLogsToCollect || 50,
  };

  saveSettings(config);
  console.log(chalk.green("\n✅ Settings saved!\n"));
  return config;
};

export const runSettingsMenu = async (): Promise<void> => {
  while (true) {
    const existing = loadSettings();
    console.log(chalk.cyan("\n⚙️  Settings Menu\n"));
    console.log(`${chalk.yellow("Provider:")} ${existing.provider || "Not set"}`);
    console.log(`${chalk.yellow("Model:")}    ${existing.model || "Not set"}`);
    console.log(`${chalk.yellow("API Key:")}  ${existing.apiKey ? "********" : "Not set"}`);
    console.log(`${chalk.yellow("Username:")} ${existing.geocachingUsername || "Not set"}`);
    console.log(`${chalk.yellow("Max Logs:")} ${existing.maxLogsToCollect ?? 50}`);
    console.log("");

    const { choice } = await inquirer.prompt<{ choice: string }>({
      type: "select",
      name: "choice",
      message: "What would you like to adjust?",
      choices: [
        { name: "🤖  Change Provider & API URL", value: "provider" },
        { name: "📦  Change Model", value: "model" },
        { name: "🔑  Change API Key", value: "key" },
        { name: "👤  Change Geocaching Credentials", value: "credentials" },
        { name: "📊  Change Max Logs to Collect", value: "maxlogs" },
        { name: "🔄  Run Full Setup Wizard", value: "wizard" },
        new inquirer.Separator(),
        { name: "🔙  Back to Main Menu", value: "back" },
      ],
    });

    if (choice === "back") break;

    if (choice === "wizard") {
      await runSettingsWizard();
      continue;
    }

    if (choice === "provider") {
      const providerChoices = PROVIDERS.map(p => ({ name: p.name, value: p.name }));
      const { providerName } = await inquirer.prompt<{ providerName: string }>({
        type: "select",
        name: "providerName",
        message: "Select AI provider:",
        choices: providerChoices,
        default: existing.provider ?? "OpenRouter",
      });

      const selectedProvider = PROVIDERS.find(p => p.name === providerName);
      let apiBaseUrl = selectedProvider?.baseUrl || "";

      if (providerName === "Custom") {
        const { customUrl } = await inquirer.prompt<{ customUrl: string }>({
          type: "input",
          name: "customUrl",
          message: "Enter API base URL:",
          default: existing.apiBaseUrl ?? "",
        });
        apiBaseUrl = customUrl.trim();
      }
      saveSettings({ provider: providerName, apiBaseUrl });
    } else if (choice === "model") {
      const { model } = await inquirer.prompt<{ model: string }>({
        type: "input",
        name: "model",
        message: "Enter model name:",
        default: existing.model ?? "",
      });
      saveSettings({ model: model.trim() });
    } else if (choice === "key") {
      const { key } = await inquirer.prompt<{ key: string }>({
        type: "password",
        name: "key",
        message: "Enter API key:",
        mask: "*",
        default: existing.apiKey ?? "",
      });
      saveSettings({ apiKey: key });
    } else if (choice === "credentials") {
      const { user, pass } = await inquirer.prompt<{ user: string; pass: string }>([
        {
          type: "input",
          name: "user",
          message: "Geocaching username:",
          default: existing.geocachingUsername ?? "",
        },
        {
          type: "password",
          name: "pass",
          message: "Geocaching password:",
          mask: "*",
          default: existing.geocachingPassword ?? "",
        },
      ]);
      saveSettings({ geocachingUsername: user, geocachingPassword: pass });
    } else if (choice === "maxlogs") {
      const { maxLogs } = await inquirer.prompt<{ maxLogs: number }>({
        type: "number",
        name: "maxLogs",
        message: "Maximum number of logs to collect:",
        default: existing.maxLogsToCollect ?? 50,
      });
      saveSettings({ maxLogsToCollect: maxLogs || 50 });
    }

    console.log(chalk.green("\n✅ Setting updated!"));
  }
};
