#!/usr/bin/env ts-node

import "dotenv/config.js";
import fs from "fs";
import inquirer from "inquirer";
import OpenAI from "openai";
import path from "path";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { fileURLToPath } from "url";

// TypeScript import for Node's "URL" or "fileURLToPath" usage:
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cookiesPath = path.join(__dirname, "cookies.json");

const GC_USERNAME = process.env.GEOCACHING_USERNAME || "";
const GC_PASSWORD = process.env.GEOCACHING_PASSWORD || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

if (!GC_USERNAME || !GC_PASSWORD || !OPENAI_KEY) {
  console.error("ERROR: Missing required env variables in .env");
  process.exit(1);
}

// Optional CLI code
let cliCode: string | null = process.argv[2] || null;

// Validate code if given
if (cliCode && !/^GC[a-zA-Z0-9]+$/.test(cliCode)) {
  console.error(`Invalid geocache code format: ${cliCode}`);
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_KEY });

interface LogItem {
  user: string;
  date: string;
  text: string;
  logType: string;
}

(async function main(): Promise<void> {
  const multiMode = !cliCode;

  // Initialize the browser flow once
  const { browser, page } = await initBrowserFlow();

  if (multiMode) {
    // first prompt for code while we are logged in
    while (true) {
      const code = await askUserForCode(/* allowBlank */ true);
      if (!code) {
        console.log("No code entered. Exiting.");
        break;
      }
      await runSingleWorkflow(page, code);
      // then confirm if we want more
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
    // single-run with the CLI code
    await runSingleWorkflow(page, cliCode);
  }

  await browser.close();
  process.exit(0);
})().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

/**
 * Launch the browser, load cookies, check cookie overlay, do login once
 */
async function initBrowserFlow(): Promise<{ browser: any; page: any }> {
  puppeteer.use(StealthPlugin());

  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  await loadCookies(page);

  // Attempt sign-in page
  await page.goto("https://www.geocaching.com/account/signin", { waitUntil: "networkidle2" });

  // If we see /signin => do cookie overlay & login
  if (page.url().includes("/account/signin")) {
    await handleCookiebotOverlay(page);

    const loggedIn = !page.url().includes("/account/signin");
    if (!loggedIn) {
      console.log("Not logged in. Logging in now...");
      await doLogin(page, GC_USERNAME, GC_PASSWORD);
      console.log("Login successful. Saving cookies...");
      await saveCookies(page);
    }
  } else {
    console.log("Already logged in (cookies loaded).");
  }

  return { browser, page };
}

/**
 * Ask user for code
 * If allowBlank==true => user can input blank to exit
 */
async function askUserForCode(allowBlank: boolean): Promise<string | null> {
  while (true) {
    const { code } = await inquirer.prompt<{ code: string }>({
      type: "input",
      name: "code",
      message: "Enter a geocache code (e.g. GC12345) or blank to exit:",
    });

    if (!code) {
      if (allowBlank) return null;
      console.log("No code given. Please try again.");
      continue;
    }
    if (!/^GC[a-zA-Z0-9]+$/.test(code)) {
      console.log("Invalid format. Must be GC plus letters/numbers. Try again.\n");
      continue;
    }
    return code;
  }
}

/**
 * The workflow for a single geocache code
 */
async function runSingleWorkflow(page: any, code: string): Promise<void> {
  // ask personal notes
  const notesPromise = askUserForPersonalNotes();

  // navigate
  const cacheUrl = `https://www.geocaching.com/geocache/${code}`;
  await page.goto(cacheUrl, { waitUntil: "networkidle2" });

  // fetch name
  let cacheName = "";
  try {
    cacheName = await page.$eval(
      "#ctl00_ContentBody_CacheName",
      (el: Element) => el.textContent?.trim() || "",
    );
  } catch {
    console.warn(`Could not read cache name for ${code}`);
  }

  // gather logs
  const logs = await collectGefundenLogs(page, 40);
  console.log(`Collected ${logs.length} "Gefunden" logs for ${code}.`);
  if (logs.length === 0) {
    console.warn("No logs found. Skipping.");
    return;
  }

  // findCount
  let findCount: number | undefined;
  try {
    const findCountStr = await page.$eval(
      ".player-profile span:nth-child(2)",
      (el: Element) => el.textContent?.trim() || "",
    );
    findCount = Number.parseInt(findCountStr.replace(/[^\d]/g, ""));
  } catch {
    findCount = undefined;
  }

  // wait for personal notes
  const personalNotes = await notesPromise;
  const newLog = await generateLogEntry(cacheName, logs, findCount, personalNotes);
  console.log(`\n=== AI-Suggested New Log Entry for "${cacheName}" ===\n`);
  console.log(newLog);
}

/**
 * Prompt user for personal notes
 */
async function askUserForPersonalNotes(): Promise<string> {
  const { personalNotes } = await inquirer.prompt<{ personalNotes: string }>([
    {
      type: "input",
      name: "personalNotes",
      message: "Enter any personal notes or remarks for the log:",
    },
  ]);
  return personalNotes || "";
}

/**
 * Load cookies from disk if they exist
 */
async function loadCookies(page: any): Promise<void> {
  if (!fs.existsSync(cookiesPath)) {
    console.log("No cookies file found, skipping load.");
    return;
  }
  try {
    const cookiesJson = fs.readFileSync(cookiesPath, "utf-8");
    const cookies = JSON.parse(cookiesJson);
    if (Array.isArray(cookies)) {
      for (const cookie of cookies) {
        await page.setCookie(cookie);
      }
      console.log(`Loaded ${cookies.length} cookies from disk.`);
    }
  } catch (err) {
    console.error("Failed to load cookies:", err);
  }
}

/**
 * Save cookies after successful login
 */
async function saveCookies(page: any): Promise<void> {
  try {
    const client = await page.target().createCDPSession();
    const allCookies = (await client.send("Network.getAllCookies"))?.cookies || [];
    fs.writeFileSync(cookiesPath, JSON.stringify(allCookies, null, 2), "utf-8");
    console.log(`Saved ${allCookies.length} cookies to ${cookiesPath}`);
  } catch (err) {
    console.error("Failed to save cookies:", err);
  }
}

/**
 * Handle Cookiebot overlay once
 */
async function handleCookiebotOverlay(page: any): Promise<void> {
  try {
    await page.waitForSelector("#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll", {
      timeout: 3000,
    });
    await page.click("#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll");
    console.log('Clicked "Necessary" on Cookiebot overlay');
    await delay(1000);
  } catch {
    console.log('No Cookiebot overlay or "Necessary" button not found.');
  }
}

/**
 * Do login
 */
async function doLogin(page: any, username: string, password: string): Promise<void> {
  await page.waitForSelector("#UsernameOrEmail");
  await page.type("#UsernameOrEmail", username, { delay: 50 });

  await page.waitForSelector("#Password");
  await page.type("#Password", password, { delay: 50 });

  await page.click("#SignIn");
  await page.waitForNavigation({ waitUntil: "networkidle2" });
}

/**
 * Collect at least minCount "Gefunden" logs
 */
async function collectGefundenLogs(page: any, minCount: number = 40): Promise<LogItem[]> {
  let logs: LogItem[] = [];
  let attempts = 0;
  const maxAttempts = 10;

  while (logs.length < minCount && attempts < maxAttempts) {
    const newLogs = await fetchGefundenLogs(page);
    logs = mergeLogs(logs, newLogs);
    console.log(`Scroll #${attempts + 1}: we have ${logs.length} "Gefunden" logs.`);

    if (logs.length >= minCount) break;

    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    attempts++;
    await delay(2000);
  }
  return logs;
}

/**
 * Extract "Gefunden" logs from the page
 */
async function fetchGefundenLogs(page: any): Promise<LogItem[]> {
  return page.$$eval("#cache_logs_table tr.log-row", (rows: Element[]) => {
    return rows
      .map(row => {
        const typeImg = row.querySelector<HTMLImageElement>(".LogType img");
        const logType = typeImg?.getAttribute("title")?.trim() || "";
        if (logType !== "Gefunden") return null;

        const userEl = row.querySelector<HTMLElement>(".LogDisplayLeft .h5");
        const user = userEl ? userEl.textContent?.trim() || "UnknownUser" : "UnknownUser";

        const dateEl = row.querySelector<HTMLElement>(".LogDate, .minorDetails.LogDate");
        const date = dateEl ? dateEl.textContent?.trim() || "UnknownDate" : "UnknownDate";

        const textEl = row.querySelector<HTMLElement>(".LogText");
        const text = textEl ? textEl.textContent?.trim() || "" : "";

        return { user, date, text, logType };
      })
      .filter(Boolean) as LogItem[];
  });
}

/**
 * Merge logs ignoring duplicates
 */
function mergeLogs(existing: LogItem[], newLogs: LogItem[]): LogItem[] {
  const merged = [...existing];
  for (const log of newLogs) {
    const duplicate = merged.some(
      x => x.user === log.user && x.date === log.date && x.text === log.text,
    );
    if (!duplicate) merged.push(log);
  }
  return merged;
}

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate final log referencing personal notes
 */
async function generateLogEntry(
  cacheName: string,
  logs: LogItem[],
  findCount: number | undefined,
  personalNotes: string,
): Promise<string> {
  const subset = logs.slice(0, 30);
  const logsText = subset.map((l, i) => `[Log #${i + 1}]: ${l.text}`).join("\n\n");

  const userPrompt = `
Schreibe ein Geocaching-Log, das enthusiastisch und detailliert ist und eine persönliche Erzählung über die Suche und das Finden des Caches enthält. Verwende einen wertschätzenden und positiven Ton. Erwähne Herausforderungen sowie bemerkenswerte Eigenschaften des Ortes oder Caches die andere Personen in den Logs ebenfalls schildern. Füge Ausdrücke von Anstrengung oder Erfolg hinzu, die du in anderen Einträgen findest. Der Logeintrag sollte eine kleine Geschichte erzählen und die Kreativität und Mühe des Cache-Owners würdigen. Die Länge sollte ca. 60 Wörter betragen. Falls es weniger Inhalte gibt die es wert sind erwähnt zu werden, kann der Log auch kürzer sein.
Das Log soll so klingen, als ob es von einem echten Geocacher stammt, der den Cache tatsächlich gefunden hat.

Persönliche Notizen (vom User hinzugefügt):
${personalNotes}

Orientiere dich dabei an den folgenden Log-Einträgen von bisherigen Findern:
---
${logsText}
---
`.trim();

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "Du bist ein hilfreicher Assistent, der Geocache-Logs in deutscher Sprache schreibt.",
      },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
  });

  const content = response.choices?.[0]?.message?.content?.trim() || "";
  const findNumber = findCount !== undefined ? ` (#${findCount + 1})` : "";
  return `[${cacheName}]\n\n${content}\n\nTFTC!${findNumber}`;
}
