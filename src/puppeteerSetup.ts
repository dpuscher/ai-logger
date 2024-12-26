import fs from "node:fs";
import chalk from "chalk";
import ora from "ora";
import { DEFAULT_INTERCEPT_RESOLUTION_PRIORITY, type Page } from "puppeteer";
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
export async function launchPuppeteer() {
  const spinner = ora(chalk.blue("Launching Puppeteer...")).start();
  try {
    // @ts-expect-error - Types of plugin are wrong
    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1920,1080",
      ],
      defaultViewport: null, // Use default viewport
    });
    const page = await browser.newPage();

    // Set a realistic user-agent
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/115.0.0.0 Safari/537.36",
    );

    spinner.succeed(chalk.green("Puppeteer launched successfully!"));
    return { browser, page };
  } catch (err) {
    spinner.fail(chalk.red(`Failed to launch Puppeteer: ${err}`));
    process.exit(1);
  }
}

/**
 * Load cookies if they exist
 */
export async function loadCookies(page: Page): Promise<void> {
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
}

/**
 * Save cookies
 */
export async function saveCookies(page: Page): Promise<void> {
  const spinner = ora(chalk.blue("Saving cookies...")).start();
  try {
    const client = await page.target().createCDPSession();
    const allCookies = (await client.send("Network.getAllCookies"))?.cookies || [];
    fs.writeFileSync(cookiesPath, JSON.stringify(allCookies, null, 2), "utf-8");
    spinner.succeed(chalk.green(`Saved ${allCookies.length} cookies to ${cookiesPath}`));
  } catch (err) {
    spinner.fail(chalk.red(`Failed to save cookies: ${err}`));
  }
}

/**
 * Cookiebot overlay (once on first page)
 */
export async function handleCookiebotOverlay(page: Page): Promise<void> {
  const spinner = ora(chalk.blue("Checking for Cookiebot overlay...")).start();
  try {
    await page.waitForSelector("#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll", {
      timeout: 2000,
    });
    await page.click("#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll");
    spinner.succeed(chalk.green('Clicked "Necessary" on Cookiebot overlay.'));
    await sleep(1000);
  } catch {
    spinner.info(chalk.yellow('No Cookiebot overlay or "Necessary" button not found.'));
  }
}

/**
 * Attempt login if not already logged in
 */
export async function doLogin(page: Page, username: string, password: string): Promise<void> {
  const spinner = ora(chalk.blue("Attempting to log in...")).start();
  try {
    await page.waitForSelector("#UsernameOrEmail");
    await page.type("#UsernameOrEmail", username, { delay: 50 });

    await page.waitForSelector("#Password");
    await page.type("#Password", password, { delay: 50 });

    await page.click("#SignIn");
    await page.waitForNavigation({ waitUntil: "networkidle2" });

    spinner.succeed(chalk.green("Login successful."));
  } catch (err) {
    spinner.fail(chalk.red(`Login failed: ${err}`));
    process.exit(1);
  }
}
