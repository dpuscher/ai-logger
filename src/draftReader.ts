import chalk from "chalk";
import ora from "ora";
import type { Page } from "puppeteer";
import { sleep } from "./utils.js";

export interface DraftInfo {
  code: string;
  draftId: string;
  name: string;
}

/**
 * fetchDraftInfos - read the GC code and the draft ID from the /account/drafts page
 */
export const fetchDraftInfos = async (page: Page): Promise<DraftInfo[]> => {
  const spinner = ora(chalk.blue("Reading draft list...")).start();
  const draftItemSelector = ".draft-item";

  try {
    await page.waitForSelector("#draftList");

    // Scroll the window until the number of draft items does not increase
    let previousCount = 0;
    while (true) {
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await sleep(1000);
      const currentCount = await page.$$eval(draftItemSelector, items => items.length);
      if (currentCount === previousCount) break;
      previousCount = currentCount;
      spinner.text = chalk.blue(`Reading draft list... (found ${chalk.magenta(currentCount)})`);
    }

    const results = await page.$$eval(draftItemSelector, (items: Element[]) => {
      const gcQueryPattern = /[?&]gc=(GC[a-zA-Z0-9]+)/;
      const draftQueryPattern = /[?&]d=([A-Za-z0-9]+)/;
      const results: DraftInfo[] = [];
      for (const item of items) {
        const anchor = item.querySelector<HTMLAnchorElement>(".draft-content a");
        if (!anchor) continue;

        const url = anchor.getAttribute("href") || "";

        // example: "/account/drafts/home/compose?gc=GC7B9WZ&d=LDADHTQY..."
        const codeMatch = url.match(gcQueryPattern);
        const draftMatch = url.match(draftQueryPattern);
        const code = codeMatch?.[1] ?? "";
        const draftId = draftMatch?.[1] ?? "";

        const nameElement = item.querySelector(".title");
        const name = nameElement ? nameElement.textContent?.trim() || "" : "";

        if (code && draftId) {
          results.push({ code, draftId, name });
        }
      }
      return results;
    });

    spinner.succeed(chalk.green(`Found ${results.length} drafts.`));
    return results;
  } catch (err) {
    spinner.fail(chalk.red(`Failed to read drafts: ${err}`));
    return [];
  }
};
