import chalk from "chalk";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import ora from "ora";
import { OPENAI_KEY } from "./config.js";
import type { LogItem } from "./logCollector.js";

const openai = new OpenAI({ apiKey: OPENAI_KEY });
const messages: ChatCompletionMessageParam[] = [];

/**
 * Generate final AI log text
 */
export async function generateLogEntry(
  cacheName: string,
  logs: LogItem[],
  personalNotes: string,
): Promise<string> {
  const spinner = ora(
    chalk.blue(`Generating AI-based log text for cache: ${cacheName}...`),
  ).start();
  const subset = logs.slice(0, 30);
  const logsText = subset.map((l, i) => `[Log #${i + 1}]: ${l.text}`).join("\n\n");

  const userPrompt = `
Schreibe ein Geocaching-Log, das enthusiastisch und detailliert ist und eine persönliche Erzählung über die Suche und das Finden des Caches enthält. Verwende einen wertschätzenden und positiven Ton. Erwähne Herausforderungen sowie bemerkenswerte Eigenschaften des Ortes oder Caches, die andere Personen in den Logs ebenfalls schildern. Füge Ausdrücke von Anstrengung oder Erfolg hinzu, die du in anderen Einträgen findest. Der Logeintrag sollte eine kleine Geschichte erzählen und die Kreativität und Mühe des Cache-Owners würdigen. Die Länge sollte ca. 60 Wörter betragen. Falls es weniger Inhalte gibt, kann der Log auch kürzer sein.
Das Log soll so klingen, als ob es von einem echten Geocacher stammt, der den Cache tatsächlich gefunden hat.

Persönliche Notizen (vom User hinzugefügt):
${personalNotes}

Orientiere dich dabei an den folgenden Log-Einträgen von bisherigen Findern:
---
${logsText}
---
`.trim();

  // Initialize messages with system and user prompts
  messages.push(
    {
      role: "system",
      content:
        "Du bist ein hilfreicher Assistent, der Geocache-Logs in deutscher Sprache schreibt.",
    },
    { role: "user", content: userPrompt },
  );

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
      temperature: 0.7,
    });

    const content = response.choices?.[0]?.message?.content?.trim() || "";
    spinner.succeed(chalk.green("AI log generation completed!"));
    return content;
  } catch (err) {
    spinner.fail(chalk.red(`Failed to generate AI log entry: ${err}`));
    throw err;
  }
}

/**
 * Refine existing AI log text using chat history or thread
 */
export async function refineLogEntry(existingLog: string, prompt: string): Promise<string> {
  const spinner = ora(chalk.blue("Refining AI-based log text...")).start();

  // Append refinement prompt to messages
  messages.push(
    {
      role: "assistant",
      content: existingLog,
    },
    {
      role: "user",
      content: prompt,
    },
  );

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
      temperature: 0.7,
    });

    const content = response.choices?.[0]?.message?.content?.trim() || "";
    spinner.succeed(chalk.green("AI log refinement completed!"));
    return content;
  } catch (err) {
    spinner.fail(chalk.red(`Failed to refine AI log entry: ${err}`));
    throw err;
  }
}
