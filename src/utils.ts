import childProcess from "node:child_process";
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";

/**
 * For manual mode: let user input GC code
 */
export const promptUserForCacheCode = async (): Promise<string | null> => {
  const { code } = await inquirer.prompt<{ code: string }>({
    type: "input",
    name: "code",
    message: "Enter a geocache code (e.g. GC12345) or just press ENTER to exit:",
  });
  if (!code) return null;
  if (!/^GC[a-zA-Z0-9]+$/.test(code)) {
    console.log(chalk.red("❌ Invalid code format. Must be GC plus letters/numbers."));
    return null;
  }
  return code;
};

/**
 * Ask user for personal notes
 */
export const askUserForPersonalNotes = async (): Promise<string> => {
  const { personalNotes } = await inquirer.prompt<{ personalNotes: string }>([
    {
      type: "input",
      name: "personalNotes",
      message: "Enter any personal notes or remarks for this log:",
    },
  ]);
  return personalNotes || "";
};

/**
 * openInDefaultBrowser
 */
export const openInDefaultBrowser = (url: string) => {
  const spinner = ora(chalk.blue(`Opening the log page in your default browser: ${url}`)).start();
  const platform = process.platform;
  let command = "";
  if (platform === "darwin") {
    command = "open";
  } else if (platform === "win32") {
    command = "start";
  } else {
    command = "xdg-open";
  }
  try {
    childProcess.exec(`${command} "${url}"`);
    spinner.succeed(chalk.green(`Opened in default browser: ${url}`));
  } catch (err) {
    spinner.fail(chalk.red(`Error opening in default browser: ${err}`));
  }
};

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
