#!/usr/bin/env node

import chalk from "chalk";
import clipboardy from "clipboardy";
import inquirer from "inquirer";
import ora from "ora";
import type { Page } from "puppeteer";
import { getConfig } from "./config.js";
import { fetchDraftInfos } from "./draftReader.js";
import { collectFoundLogs } from "./logCollector.js";
import type { AIConfig } from "./openAiHelper.js";
import { checkLoggingRequirements, generateLogEntry, refineLogEntry } from "./openAiHelper.js";
import {
  doLogin,
  handleCookiebotOverlay,
  launchPuppeteer,
  loadCookies,
  saveCookies,
} from "./puppeteerSetup.js";
import { runSettingsWizard } from "./settings.js";
import { askUserForPersonalNotes, openInDefaultBrowser, promptUserForCacheCode } from "./utils.js";

// Handles login if the current page is the sign-in page.
// Geocaching.com sets ReturnUrl, so after successful login we land on the original target.
const loginIfNeeded = async (
  page: Page,
  geocachingUsername: string,
  geocachingPassword: string,
): Promise<void> => {
  if (!page.url().includes("/account/signin")) return;

  await handleCookiebotOverlay(page);

  let loggedIn = false;
  let useStoredCredentials = !!(geocachingUsername && geocachingPassword);

  while (!loggedIn) {
    const credentials = useStoredCredentials
      ? { username: geocachingUsername, password: geocachingPassword }
      : await inquirer.prompt<{ username: string; password: string }>([
          {
            type: "input",
            name: "username",
            message: "Enter your Geocaching.com username:",
          },
          {
            type: "password",
            name: "password",
            message: "Enter your Geocaching.com password:",
            mask: "*",
          },
        ]);

    useStoredCredentials = false;

    const spinnerLogin = ora(chalk.yellow("Logging in...")).start();
    await doLogin(page, credentials.username, credentials.password);
    await saveCookies(page);

    if (page.url().includes("/account/signin")) {
      spinnerLogin.fail(chalk.red("Login failed. Please try again."));
    } else {
      spinnerLogin.succeed(chalk.green("Login successful."));
      loggedIn = true;
    }
  }
};

// Robust navigation with retries. Cache pages are publicly accessible (no redirect
// to sign-in), so auth state is detected via window.isLoggedIn injected by geocaching.com.
const navigateWithRetries = async (
  page: Page,
  url: string,
  geocachingUsername: string,
  geocachingPassword: string,
  attempts = 3,
): Promise<void> => {
  const strategies: Array<"networkidle2" | "domcontentloaded" | "load"> = [
    "domcontentloaded",
    "load",
    "networkidle2",
  ];
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const waitUntil = strategies[Math.min(i, strategies.length - 1)];
    try {
      await page.goto(url, { waitUntil, timeout: 60_000 });

      // Cache pages load for anonymous users too, so check auth via injected JS variable
      const isLoggedIn = await page.evaluate(
        () => (window as unknown as { isLoggedIn: boolean }).isLoggedIn === true,
      );
      if (!isLoggedIn) {
        const returnPath = new URL(url).pathname;
        await page.goto(
          `https://www.geocaching.com/account/signin?ReturnUrl=${encodeURIComponent(returnPath)}`,
          { waitUntil: "domcontentloaded" },
        );
        await loginIfNeeded(page, geocachingUsername, geocachingPassword);
        // After login geocaching.com honors ReturnUrl, so we're back on the cache page
      }

      await page.waitForSelector("#ctl00_ContentBody_CacheName", {
        timeout: 15_000,
      });
      return;
    } catch (err) {
      lastError = err;
      const backoffMs = 1500 * (i + 1);
      console.warn(
        chalk.yellow(
          `Navigation attempt ${i + 1}/${attempts} failed (waitUntil=${waitUntil}). Retrying in ${backoffMs}ms...`,
        ),
      );
      await new Promise(res => setTimeout(res, backoffMs));
    }
  }
  throw lastError;
};

const runCachingSession = async (
  modeChoice: "manual" | "drafts",
  aiConfig: AIConfig,
  geocachingUsername: string,
  geocachingPassword: string,
) => {
  const { browser, page } = await launchPuppeteer();
  await loadCookies(page);

  if (modeChoice === "manual") {
    while (true) {
      const code = await promptUserForCacheCode();
      if (!code) {
        console.log(chalk.gray("No code entered. Exiting."));
        break;
      }
      await runSingleWorkflow(page, aiConfig, code, null, geocachingUsername, geocachingPassword);
      const { again } = await inquirer.prompt<{ again: boolean }>([
        {
          type: "confirm",
          name: "again",
          message: "Create another log entry for a different geocache code?",
          default: false,
        },
      ]);
      if (!again) break;
    }
  } else {
    // Navigate directly to drafts — geocaching.com will redirect to sign-in with ReturnUrl
    // set to /account/drafts if we're not authenticated. After login we land back here.
    const spinnerDraft = ora(chalk.blue("Loading drafts...")).start();
    await page.goto("https://www.geocaching.com/account/drafts", {
      waitUntil: "domcontentloaded",
    });
    if (page.url().includes("/account/signin")) {
      spinnerDraft.stop();
      await loginIfNeeded(page, geocachingUsername, geocachingPassword);
    }
    spinnerDraft.succeed(chalk.green("Drafts page loaded."));

    const draftInfos = await fetchDraftInfos(page);
    if (!draftInfos.length) {
      console.log(chalk.yellow("No drafts found. Exiting."));
      await browser.close();
      return;
    }
    console.log(chalk.cyan(`Found ${draftInfos.length} drafts:`));
    for (let i = 0; i < draftInfos.length; i++) {
      console.log(`  ${chalk.magenta(draftInfos[i].code)} – ${chalk.green(draftInfos[i].name)}`);
    }

    const { proceed } = await inquirer.prompt<{ proceed: boolean }>({
      type: "confirm",
      name: "proceed",
      message: `Proceed to create logs for these ${draftInfos.length} drafts?`,
      default: true,
    });
    if (!proceed) {
      console.log(chalk.gray("Ok, not proceeding."));
      await browser.close();
      return;
    }

    for (let i = 0; i < draftInfos.length; i++) {
      const info = draftInfos[i];
      console.log(
        chalk.blueBright(
          `\nCreating log for draft #${i + 1}: ${info.code} (${info.name})\nLink: https://coord.info/${info.code}\n`,
        ),
      );
      await runSingleWorkflow(
        page,
        aiConfig,
        info.code,
        info.draftId,
        geocachingUsername,
        geocachingPassword,
      );

      if (i < draftInfos.length - 1) {
        const { again } = await inquirer.prompt<{ again: boolean }>({
          type: "confirm",
          name: "again",
          message: "Create next draft log?",
          default: true,
        });
        if (!again) {
          console.log(chalk.gray("Ok, stopping here."));
          break;
        }
      }
    }
  }

  console.log(chalk.greenBright("All done! Have fun geocaching! ✨"));
  await browser.close();
};

const displayLog = async (
  cacheName: string,
  logContent: string,
  logType: "AI-Suggested" | "Refined",
  findCount: number | undefined,
) => {
  console.log(chalk.magentaBright(`\n=== ${logType} Log Entry for "${cacheName}" ===\n`));
  console.log(logContent);
  console.log(`\nTFTC! (#${(findCount ?? 0) + 1})`);
};

const runSingleWorkflow = async (
  page: Page,
  aiConfig: AIConfig,
  code: string,
  draftId: string | null,
  geocachingUsername: string,
  geocachingPassword: string,
) => {
  const personalNotes = await askUserForPersonalNotes();

  const spinnerCache = ora(chalk.blue(`Loading geocache page for code: ${code}...`)).start();
  const cacheUrl = `https://www.geocaching.com/geocache/${code}`;
  await navigateWithRetries(page, cacheUrl, geocachingUsername, geocachingPassword, 3);
  spinnerCache.succeed(chalk.green(`Geocache page loaded for code: ${code}.`));

  let cacheName = "";
  let cacheDescription = "";
  try {
    cacheName = await page.$eval(
      "#ctl00_ContentBody_CacheName",
      (el: Element) => el.textContent?.trim() || "",
    );
  } catch {
    console.warn(chalk.red(`Could not read cache name for ${code}`));
  }
  try {
    await page
      .waitForSelector("#ctl00_ContentBody_ShortDescription, #ctl00_ContentBody_LongDescription", {
        timeout: 5_000,
      })
      .catch(() => {});
    cacheDescription = await page.evaluate(() => {
      const short =
        document.querySelector("#ctl00_ContentBody_ShortDescription")?.textContent?.trim() || "";
      const long =
        document.querySelector("#ctl00_ContentBody_LongDescription")?.textContent?.trim() || "";
      return [short, long].filter(Boolean).join("\n\n").slice(0, 2000);
    });
    if (cacheDescription) {
      console.log(chalk.gray(`  Cache description found (${cacheDescription.length} chars).`));
    }
  } catch {
    // description is optional
  }

  // Kick off AI requirements check immediately — runs in parallel with log collection
  const requirementsPromise = cacheDescription
    ? checkLoggingRequirements(aiConfig, cacheDescription)
    : Promise.resolve<string[]>([]);

  const logs = await collectFoundLogs(page, 500);
  if (!logs.length) {
    console.log(chalk.yellow('No "Found" logs found. Nothing to do here...'));
    return;
  }

  let findCount: number | undefined;
  try {
    findCount = await page.evaluate((): number | undefined => {
      try {
        const usernameEl = document.querySelector("header nav .username");
        if (!usernameEl || !(usernameEl as HTMLElement).parentElement) return undefined;
        const parent = (usernameEl as HTMLElement).parentElement as HTMLElement;
        const lastChild = parent.lastChild as ChildNode | null;
        const raw = (lastChild && (lastChild as Text).textContent) || parent.textContent || "";
        const cleaned = raw.replaceAll(/[\.,]/g, "");
        const n = Number.parseInt(cleaned, 10);
        return Number.isFinite(n) ? n : undefined;
      } catch {
        return undefined;
      }
    });
  } catch {
    findCount = undefined;
  }

  const requirements = await requirementsPromise;
  if (requirements.length) {
    console.log(chalk.yellowBright("\n⚠️  Logging requirements detected:"));
    for (const req of requirements) {
      console.log(chalk.yellow(`  • ${req}`));
    }
    console.log();
  }

  console.log(chalk.magentaBright(`\n=== AI-Suggested Log Entry for "${cacheName}" ===\n`));
  const initialLog = await generateLogEntry(
    aiConfig,
    cacheName,
    logs,
    personalNotes,
    cacheDescription,
  );
  console.log(chalk.dim(`\nTFTC! (#${(findCount ?? 0) + 1})`));

  let refinedLog = initialLog;

  while (true) {
    const { refineChoice } = await inquirer.prompt<{ refineChoice: boolean }>({
      type: "confirm",
      name: "refineChoice",
      message: "Do you want to refine the log entry?",
      default: false,
    });
    if (!refineChoice) break;

    const additionalNote = await askUserForPersonalNotes();
    refinedLog = await refineLogEntry(aiConfig, refinedLog, additionalNote);
    await displayLog(cacheName, refinedLog, "Refined", findCount);
  }

  await clipboardy.write(`${refinedLog}\n\nTFTC! (#${(findCount ?? 0) + 1})`);
  console.log(chalk.green("\n✔ Log copied to clipboard!"));

  const externalLogUrl = draftId
    ? `https://www.geocaching.com/live/geocache/${code}/draft/${draftId}/compose`
    : `https://www.geocaching.com/live/geocache/${code}/log`;

  openInDefaultBrowser(externalLogUrl);
};

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));

const printBanner = (config: ReturnType<typeof getConfig>) => {
  // ... rest of printBanner ...
};

const main = async () => {
  const args = process.argv.slice(2);

  if (args.includes("--version") || args.includes("-v")) {
    console.log(pkg.version);
    process.exit(0);
  }

  if (args.includes("--help") || args.includes("-h")) {
    console.log(chalk.greenBright(`ai-logger v${pkg.version}`));
    console.log(chalk.dim("AI-powered geocaching log generator."));
    console.log(`
Usage:
  ${chalk.cyan("ai-logger")} [options]

Options:
  ${chalk.yellow("--version, -v")}    Show version number
  ${chalk.yellow("--help, -h")}       Show help message

Environment Variables:
  ${chalk.magenta("OPENROUTER_API_KEY")}   API key
  ${chalk.magenta("GEOCACHING_USERNAME")}  Auto-login username
  ${chalk.magenta("GEOCACHING_PASSWORD")}  Auto-login password
    `);
    process.exit(0);
  }

  // Load config; run setup wizard if no API key is configured
  let config = getConfig();
  if (!config.apiKey) {
    console.log();
    console.log(chalk.greenBright.bold("  Welcome to ai-logger"));
    console.log(chalk.yellow("\n  No API key configured. Let's set up your settings.\n"));
    await runSettingsWizard();
    config = getConfig();
  }

  // Main menu loop
  while (true) {
    printBanner(config);

    const { modeChoice } = await inquirer.prompt<{
      modeChoice: "manual" | "drafts" | "settings" | "exit";
    }>({
      type: "list",
      name: "modeChoice",
      message: "What would you like to do?",
      choices: [
        { name: "📋  Read from drafts", value: "drafts" },
        { name: "📝  Enter geocache code manually", value: "manual" },
        new inquirer.Separator(),
        { name: "⚙️  Settings", value: "settings" },
        { name: "🚪  Exit", value: "exit" },
      ],
    });

    if (modeChoice === "exit") {
      console.log(chalk.dim("\n  Bye!\n"));
      process.exit(0);
    }

    if (modeChoice === "settings") {
      await runSettingsWizard();
      config = getConfig();
      continue;
    }

    const aiConfig: AIConfig = {
      apiBaseUrl: config.apiBaseUrl,
      apiKey: config.apiKey,
      model: config.model,
    };

    await runCachingSession(
      modeChoice,
      aiConfig,
      config.geocachingUsername,
      config.geocachingPassword,
    );
  }
};

main().catch(err => {
  console.error(chalk.red("Fatal error:"), err);
  process.exit(1);
});
