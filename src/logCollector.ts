import chalk from "chalk";
import ora from "ora";
import type { Page } from "puppeteer";
import { sleep } from "./utils.js";

export interface LogItem {
  user: string;
  date: string;
  text: string;
  logType: string;
}

/**
 * Collect "Found" logs from a geocache detail page
 */
export const collectFoundLogs = async (page: Page, minCount: number): Promise<LogItem[]> => {
  const spinner = ora(chalk.blue(`Collecting at least ${minCount} "Found" logs...`)).start();
  let logs: LogItem[] = [];
  let attempts = 0;
  const maxAttempts = 10;

  while (logs.length < minCount && attempts < maxAttempts) {
    const newLogs = await fetchFoundLogs(page);
    logs = mergeLogs(logs, newLogs);
    spinner.text = `Scroll #${attempts + 1}: we have ${chalk.magenta(logs.length)} "Found" logs.`;

    if (logs.length >= minCount) break;

    // scroll
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await sleep(2000);
    attempts++;
  }
  spinner.succeed(chalk.green(`Collected a total of ${logs.length} "Found" logs.`));
  return logs;
};

/**
 * Grab "Found" logs from the DOM
 */
const fetchFoundLogs = async (page: Page): Promise<LogItem[]> => {
  return page.$$eval("#cache_logs_table tr.log-row", (rows: Element[]) => {
    return rows
      .map(row => {
        const typeImg = row.querySelector<HTMLImageElement>(".LogType img");
        const logType = typeImg?.getAttribute("src")?.trim() || "";
        if (!logType.endsWith("/logtypes/2.png")) {
          return null;
        }

        const userEl = row.querySelector<HTMLElement>(".LogDisplayLeft .h5");
        const user = userEl?.textContent?.trim() || "UnknownUser";

        const dateEl = row.querySelector<HTMLElement>(".LogDate, .minorDetails.LogDate");
        const date = dateEl ? dateEl.textContent?.trim() || "UnknownDate" : "UnknownDate";

        const textEl = row.querySelector<HTMLElement>(".LogText");
        const text = textEl ? textEl.textContent?.trim() || "" : "";

        return { user, date, text, logType };
      })
      .filter(Boolean) as LogItem[];
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
