import { execSync } from "node:child_process";
import fs from "node:fs";
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import { type Browser, DEFAULT_INTERCEPT_RESOLUTION_PRIORITY, type Page } from "puppeteer";
import puppeteer from "puppeteer-extra";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import BlockResourcesPlugin from "puppeteer-extra-plugin-block-resources";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { cookiesPath } from "./config.js";
import { sleep } from "./utils.js";

// Setup the stealth plugin
// @ts-expect-error - Types of plugin are wrong
puppeteer.use(StealthPlugin());

// Block images and fonts
// @ts-expect-error - Types of plugin are wrong
puppeteer.use(
  // @ts-expect-error - Types of plugin are wrong
  BlockResourcesPlugin({
    blockedTypes: new Set(["image", "font"]),
    interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
  }),
);

// Adblocker
// @ts-expect-error - Types of plugin are wrong
puppeteer.use(
  // @ts-expect-error - Types of plugin are wrong
  AdblockerPlugin({
    blockTrackersAndAnnoyances: true,
    interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
  }),
);

/**
 * Launch Puppeteer
 */
export const launchPuppeteer = async (): Promise<{ browser: Browser; page: Page }> => {
  const spinner = ora(chalk.blue("Launching Puppeteer...")).start();
  try {
    // @ts-expect-error - Types of plugin are wrong
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1920,1080",
      ],
      defaultViewport: null,
    });
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    );

    spinner.succeed(chalk.green("Puppeteer launched successfully!"));
    return { browser, page };
  } catch (err) {
    if (err instanceof Error && err.message?.includes("Could not find Chrome")) {
      spinner.fail(chalk.red("Chrome browser not found."));

      const { shouldInstall } = await inquirer.prompt<{ shouldInstall: boolean }>([
        {
          type: "confirm",
          name: "shouldInstall",
          message: "Chrome is required but not found. Would you like to install it now?",
          default: true,
        },
      ]);

      if (shouldInstall) {
        const installSpinner = ora(
          chalk.blue("Installing Chrome... (this may take a minute)"),
        ).start();
        try {
          execSync("npx puppeteer browsers install chrome", { stdio: "ignore" });
          installSpinner.succeed(chalk.green("Chrome installed successfully!"));
          return launchPuppeteer(); // Retry
        } catch (installErr) {
          installSpinner.fail(chalk.red(`Failed to install Chrome: ${installErr}`));
          process.exit(1);
        }
      } else {
        console.log(chalk.yellow("Cannot continue without Chrome. Exiting."));
        process.exit(1);
      }
    }

    spinner.fail(chalk.red(`Failed to launch Puppeteer: ${err}`));
    process.exit(1);
  }
};

/**
 * Load cookies if they exist
 */
export const loadCookies = async (page: Page): Promise<void> => {
  const spinner = ora(chalk.blue("Loading cookies...")).start();
  if (!fs.existsSync(cookiesPath)) {
    spinner.info(chalk.yellow("No cookies file found, skipping load."));
    return;
  }
  try {
    const cookiesJson = fs.readFileSync(cookiesPath, "utf-8");
    const cookies = JSON.parse(cookiesJson);
    if (Array.isArray(cookies)) {
      for (const cookie of cookies) {
        await page.browser().setCookie(cookie);
      }
      spinner.succeed(chalk.green(`Loaded ${cookies.length} cookies from disk.`));
    }
  } catch (err) {
    spinner.fail(chalk.red(`Failed to load cookies: ${err}`));
  }
};

/**
 * Save cookies
 */
export const saveCookies = async (page: Page): Promise<void> => {
  const spinner = ora(chalk.blue("Saving cookies...")).start();
  try {
    const cookies = await page.browser().cookies();
    fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2), "utf-8");
    spinner.succeed(chalk.green(`Saved ${cookies.length} cookies to ${cookiesPath}`));
  } catch (err) {
    spinner.fail(chalk.red(`Failed to save cookies: ${err}`));
  }
};

/**
 * Cookiebot overlay (once on first page)
 */
export const handleCookiebotOverlay = async (page: Page): Promise<void> => {
  const spinner = ora(chalk.blue("Checking for Cookiebot overlay...")).start();
  try {
    await page.waitForSelector("#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll", {
      timeout: 500,
    });
    await page.click("#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll");
    spinner.succeed(chalk.green('Clicked "Necessary" on Cookiebot overlay.'));
    await sleep(1000);
  } catch {
    spinner.info(chalk.yellow('No Cookiebot overlay or "Necessary" button not found.'));
  }
};

/**
 * Attempt login if not already logged in
 */
export const doLogin = async (page: Page, username: string, password: string): Promise<void> => {
  const usernameSelector = "#UsernameOrEmail";
  const passwordSelector = "#Password";

  await page.waitForSelector(usernameSelector);
  const usernameLength = await page.$eval(
    usernameSelector,
    (el: Element) => el.getAttribute("value")?.length ?? 0,
  );
  for (let i = 0; i < usernameLength; i++) {
    await page.keyboard.press("Backspace");
  }
  await page.type(usernameSelector, username, { delay: 20 });

  await page.waitForSelector(passwordSelector);
  const passwordLength = await page.$eval(
    passwordSelector,
    (el: Element) => el.getAttribute("value")?.length ?? 0,
  );
  for (let i = 0; i < passwordLength; i++) {
    await page.keyboard.press("Backspace");
  }
  await page.type(passwordSelector, password, { delay: 20 });

  await page.click("#SignIn");
  await page.waitForNavigation({ waitUntil: "domcontentloaded" });
};
