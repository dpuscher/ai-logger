#!/usr/bin/env node

import chalk from "chalk";
import clipboardy from "clipboardy";
import inquirer from "inquirer";
import ora from "ora";
import type { Page } from "puppeteer";
import { fetchDraftInfos } from "./draftReader.js";
import { collectFoundLogs } from "./logCollector.js";
import { generateLogEntry, refineLogEntry } from "./openAiHelper.js";
import {
  doLogin,
  handleCookiebotOverlay,
  launchPuppeteer,
  loadCookies,
  saveCookies,
} from "./puppeteerSetup.js";
import { askUserForPersonalNotes, openInDefaultBrowser, promptUserForCacheCode } from "./utils.js";

const main = async () => {
  console.log(chalk.greenBright("🚀 Welcome to the GC Logger!"));

  // Ask how to create logs
  const { modeChoice } = await inquirer.prompt<{ modeChoice: "manual" | "drafts" }>({
    type: "list",
    name: "modeChoice",
    message: "How do you want to create logs?",
    choices: [
      { name: "Enter codes manually", value: "manual" },
      { name: "Read from my drafts", value: "drafts" },
    ],
  });

  // init puppeteer flow
  const { browser, page } = await launchPuppeteer();

  // Load cookies + navigate to sign in
  await loadCookies(page);

  const spinnerNav = ora(chalk.blue("Navigating to sign-in page...")).start();
  await page.goto("https://www.geocaching.com/account/signin", { waitUntil: "networkidle2" });
  spinnerNav.succeed(chalk.green("Sign-in page loaded."));

  await handleCookiebotOverlay(page);

  // Check if already logged in
  if (page.url().includes("/account/signin")) {
    // Not logged in, prompt for login
    let loggedIn = false;

    while (!loggedIn) {
      const credentials = await inquirer.prompt<{ username: string; password: string }>([
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

      const spinnerLogin = ora(chalk.yellow("Logging in...")).start();
      await doLogin(page, credentials.username, credentials.password);
      await saveCookies(page);

      // Check if login was successful
      if (page.url().includes("/account/signin")) {
        spinnerLogin.fail(chalk.red("Login failed. Please try again."));
      } else {
        spinnerLogin.succeed(chalk.green("Login successful."));
        loggedIn = true;
      }
    }
  } else {
    console.log(chalk.cyan("Already logged in (cookies loaded)."));
  }

  if (modeChoice === "manual") {
    // user manually enters codes
    while (true) {
      const code = await promptUserForCacheCode();
      if (!code) {
        console.log(chalk.gray("No code entered. Exiting."));
        break;
      }
      await runSingleWorkflow(page, code, null);
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
    // read from drafts
    const spinnerDraft = ora(chalk.blue("Navigating to Drafts page...")).start();
    await page.goto("https://www.geocaching.com/account/drafts", { waitUntil: "networkidle2" });
    spinnerDraft.succeed(chalk.green("Drafts page loaded."));

    const draftInfos = await fetchDraftInfos(page);
    if (!draftInfos.length) {
      console.log(chalk.yellow("No drafts found. Exiting."));
      await browser.close();
      process.exit(0);
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
      console.log(chalk.gray("Ok, not proceeding. Exiting."));
      await browser.close();
      process.exit(0);
    }

    for (let i = 0; i < draftInfos.length; i++) {
      const info = draftInfos[i];
      console.log(
        chalk.blueBright(
          `\nCreating log for draft #${i + 1}: ${info.code} (${info.name})\nLink: https://coord.info/${info.code}\n`,
        ),
      );
      await runSingleWorkflow(page, info.code, info.draftId);

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
  process.exit(0);
};

const displayLog = async (
  cacheName: string,
  logContent: string,
  logType: "AI-Suggested" | "Refined",
) => {
  console.log(chalk.magentaBright(`\n=== ${logType} Log Entry for "${cacheName}" ===\n`));
  console.log(logContent);
};

// Modify runSingleWorkflow to allow refining logs instead of multiple recreations
const runSingleWorkflow = async (page: Page, code: string, draftId: string | null) => {
  // gather personal notes
  const personalNotes = await askUserForPersonalNotes();

  // load the geocache page
  const spinnerCache = ora(chalk.blue(`Loading geocache page for code: ${code}...`)).start();
  const cacheUrl = `https://www.geocaching.com/geocache/${code}`;
  await page.goto(cacheUrl, { waitUntil: "networkidle2" });
  spinnerCache.succeed(chalk.green(`Geocache page loaded for code: ${code}.`));

  // get name
  let cacheName = "";
  try {
    cacheName = await page.$eval(
      "#ctl00_ContentBody_CacheName",
      (el: Element) => el.textContent?.trim() || "",
    );
  } catch {
    console.warn(chalk.red(`Could not read cache name for ${code}`));
  }

  // gather logs
  const logs = await collectFoundLogs(page, 40);
  if (!logs.length) {
    console.log(chalk.yellow('No "Found" logs found. Nothing to do here...'));
    return;
  }

  // user find count
  let findCount: number | undefined;
  try {
    // Update the selector to target the correct span containing "Funde"
    const findCountStr = await page.$eval(
      ".player-profile span.flex-col span:last-child",
      (el: Element) => el.textContent?.trim() || "",
    );
    findCount = Number.parseInt(findCountStr.replace(/[^\d]/g, ""), 10);
  } catch {
    findCount = undefined;
  }

  // generate initial AI log
  const initialLog = await generateLogEntry(cacheName, logs, personalNotes);
  await displayLog(cacheName, initialLog, "AI-Suggested");

  // Initialize refinedLog with the initial log
  let refinedLog = initialLog;

  // Loop to allow continuous refinements
  while (true) {
    const { refineChoice } = await inquirer.prompt<{ refineChoice: boolean }>({
      type: "confirm",
      name: "refineChoice",
      message: "Do you want to refine the log entry?",
      default: false,
    });
    if (!refineChoice) break;

    const additionalNote = await askUserForPersonalNotes();
    refinedLog = await refineLogEntry(refinedLog, additionalNote);
    await displayLog(cacheName, refinedLog, "Refined");
  }

  await clipboardy.write(`${refinedLog}\n\nTFTC! (#${(findCount ?? 0) + 1})`); // Copy to clipboard

  // open official log page in system browser
  const externalLogUrl = draftId
    ? `https://www.geocaching.com/live/geocache/${code}/draft/${draftId}/compose`
    : `https://www.geocaching.com/live/geocache/${code}/log`;

  openInDefaultBrowser(externalLogUrl);
};

main().catch(err => {
  console.error(chalk.red("Fatal error:"), err);
  process.exit(1);
});
