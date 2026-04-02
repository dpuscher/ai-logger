import chalk from "chalk";
import ora from "ora";
import type { Page } from "puppeteer";
import { sleep } from "./utils.js";

export interface LogItem {
  user: string;
  date: string;
  text: string;
}

/**
 * Collect "Found" logs from a geocache detail page
 */
export const collectFoundLogs = async (page: Page, minCount: number): Promise<LogItem[]> => {
  const spinner = ora(chalk.blue(`Collecting at least ${minCount} "Found" logs...`)).start();
  let logs: LogItem[] = [];
  let attempts = 0;
  const maxAttempts = 20;
  let reachedEnd = false;

  while (logs.length < minCount && attempts < maxAttempts) {
    const { foundLogs, hasPublishedLog } = await fetchLogs(page);
    const previousCount = logs.length;
    logs = mergeLogs(logs, foundLogs);

    spinner.text = `Scroll #${attempts + 1}: we have ${chalk.magenta(logs.length)} "Found" logs.`;

    if (hasPublishedLog) {
      spinner.info(chalk.gray(' Reached "Published" log. Stopping collection.'));
      reachedEnd = true;
      break;
    }

    if (logs.length >= minCount) break;

    // scroll to bottom to trigger loading
    await page.evaluate(() => {
      const loader = document.querySelector("#pnlLazyLoad");
      if (loader) {
        loader.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        window.scrollTo(0, document.body.scrollHeight);
      }
    });

    // Wait for the loader to potentially appear and then disappear
    try {
      // First, wait for loader to be visible OR just wait a bit
      await sleep(1000);

      // Now wait for the loader to be hidden (none)
      await page.waitForFunction(
        () => {
          const loader = document.querySelector("#pnlLazyLoad");
          if (!loader) return true;
          return (loader as HTMLElement).style.display === "none";
        },
        { timeout: 10000 },
      );
    } catch {
      // timeout - maybe it didn't trigger because we are at the end?
    }

    // Check if we actually got new logs
    const { foundLogs: afterScrollLogs } = await fetchLogs(page);
    const updatedLogs = mergeLogs(logs, afterScrollLogs);

    if (updatedLogs.length === logs.length) {
      // Try one more aggressive scroll to the very bottom
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(2000);
      const { foundLogs: finalCheck } = await fetchLogs(page);
      logs = mergeLogs(logs, finalCheck);

      if (logs.length === previousCount && attempts > 0) {
        spinner.info(chalk.gray(" No more logs found after multiple attempts."));
        reachedEnd = true;
        break;
      }
    } else {
      logs = updatedLogs;
    }

    attempts++;
  }

  if (reachedEnd || logs.length >= minCount) {
    spinner.succeed(chalk.green(`Collected a total of ${logs.length} "Found" logs.`));
  } else {
    spinner.warn(chalk.yellow(`Stopped after ${attempts} attempts with ${logs.length} logs.`));
  }

  return logs;
};

/**
 * Grab logs from the DOM and identify if we reached the beginning (Published log)
 */
const fetchLogs = async (
  page: Page,
): Promise<{ foundLogs: LogItem[]; hasPublishedLog: boolean }> => {
  return page.$$eval("#cache_logs_table tr.log-row", (rows: Element[]) => {
    let hasPublishedLog = false;
    const foundLogs = rows
      .map(row => {
        const typeImg = row.querySelector<HTMLImageElement>(".LogType img");
        const logTypeUrl = typeImg?.getAttribute("src")?.trim() || "";

        // Log types: 2 = Found, 24 = Published
        if (logTypeUrl.endsWith("/logtypes/24.png")) {
          hasPublishedLog = true;
        }

        if (!logTypeUrl.endsWith("/logtypes/2.png")) {
          return null;
        }

        const userEl = row.querySelector<HTMLElement>(".LogDisplayLeft .h5");
        const user = userEl?.textContent?.trim() || "UnknownUser";

        const dateEl = row.querySelector<HTMLElement>(".LogDate, .minorDetails.LogDate");
        const date = dateEl ? dateEl.textContent?.trim() || "UnknownDate" : "UnknownDate";

        const textEl = row.querySelector<HTMLElement>(".LogText");
        const text = textEl ? textEl.textContent?.trim() || "" : "";

        return { user, date, text };
      })
      .filter(Boolean) as LogItem[];

    return { foundLogs, hasPublishedLog };
  });
};

const mergeLogs = (existing: LogItem[], newLogs: LogItem[]): LogItem[] => {
  const merged = [...existing];
  for (const log of newLogs) {
    const duplicate = merged.some(
      x => x.user === log.user && x.date === log.date && x.text === log.text,
    );
    if (!duplicate) merged.push(log);
  }
  return merged;
};
