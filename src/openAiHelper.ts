import OpenAI from "openai";
import chalk from "chalk";
import ora from "ora";
import { API_KEY } from "./config.js";
import type { LogItem } from "./logCollector.js";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://github.com/dpuscher/ai-cache-log",
    "X-Title": "ai-cache-log",
  },
});
const MODEL = "z-ai/glm-5";

const analyzePriorLogs = (texts: string[]) => {
  const wordCounts = texts.map((t) => t.split(/\s+/).filter(Boolean).length);
  const avgWords = wordCounts.length
    ? wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length
    : 0;
  const shortRatio = wordCounts.length
    ? wordCounts.filter((w) => w <= 20).length / wordCounts.length
    : 0;
  const lowerTexts = texts.map((t) => t.toLowerCase());
  const tftcRatio = lowerTexts.length
    ? lowerTexts.filter((t) => /\btftc\b/.test(t)).length / lowerTexts.length
    : 0;
  const quickEasyRatio = lowerTexts.length
    ? lowerTexts.filter((t) => /(quick|schnell|easy|einfach|kurz)\b/.test(t))
        .length / lowerTexts.length
    : 0;
  const isSimple =
    avgWords < 30 ||
    shortRatio > 0.5 ||
    tftcRatio > 0.2 ||
    quickEasyRatio > 0.35;
  return { avgWords, shortRatio, tftcRatio, quickEasyRatio, isSimple };
};

const chat = async (prompt: string, systemPrompt?: string): Promise<string> => {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });
  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.5,
    messages,
  });
  return response.choices[0]?.message?.content?.trim() ?? "";
};

/**
 * Generate final AI log text
 */
export const generateLogEntry = async (
  cacheName: string,
  logs: LogItem[],
  personalNotes: string,
  cacheDescription = "",
): Promise<string> => {
  const spinner = ora(
    chalk.blue(`Generating AI-based log text for cache: ${cacheName}...`),
  ).start();
  const subset = logs.slice(0, 30);
  const logsText = subset
    .map((l, i) => `[Log #${i + 1}]: ${l.text}`)
    .join("\n\n");

  const analysis = analyzePriorLogs(subset.map((s) => s.text));

  // Determine target length based on prior log patterns
  // Only go short if logs are clearly very brief (avg <20 words AND majority are short)
  const targetLength =
    analysis.avgWords < 20 && analysis.shortRatio > 0.6
      ? "20–40 words"
      : analysis.avgWords < 40 && analysis.shortRatio > 0.5
        ? "40–60 words"
        : "60–100 words";

  const systemPrompt = `You are a geocaching log writer. You write authentic, first-person log entries in the style and language of the prior logs provided. You always follow the exact word count target given.`;

  const userPrompt = `Write a geocaching log entry for cache "${cacheName}".

WORD COUNT TARGET: ${targetLength}. This is a strict requirement — count your words and make sure you meet it.

Language rules:
- Match the majority language of the prior logs (German or English only).
- If unclear, prefer the personal notes language; otherwise use English.

Style rules:
- First-person singular. Natural, down-to-earth tone.
- No emojis. No clichés. At most one exclamation mark.
- Use concrete details from the prior logs and personal notes. Do not invent facts.
- Do NOT use the abbreviation "TFTC".

Content guidance:
- Study the prior logs carefully — reference the kinds of details, challenges, or features mentioned there.
- Personal notes are your primary source for what actually happened. Incorporate them.
- Paraphrase ideas from prior logs; do not copy phrases verbatim.
${cacheDescription ? `\nCache description (for context):\n---\n${cacheDescription}\n---` : ""}

Personal notes:
---
${personalNotes || "(none)"}
---

Prior logs from other finders:
---
${logsText}
---

Output only the final log text. No headings, no quotes, no explanations.`.trim();

  try {
    let content = await chat(userPrompt, systemPrompt);

    if (!content) {
      const fallbackPrompt = `Write a ~60-word geocaching log. Use the majority language of the prior logs; else the personal notes language; else German. Keep it authentic, first-person, positive, and do not use "TFTC". Output only the log text.\n\nNotes:\n${personalNotes}\n\nPrior logs:\n${logsText}`;
      content = await chat(fallbackPrompt);
    }

    if (!content) {
      const sample = [personalNotes, ...subset.map((s) => s.text)]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .slice(0, 160)
        .trim();
      const addendum = sample
        ? ` Eindrücke: ${sample}`
        : " Kurze Suche, schöne Location und mit einem Lächeln geloggt.";
      content = `Heute den Cache "${cacheName}" gefunden.${addendum} Vielen Dank an den Owner!`;
    }

    spinner.succeed(chalk.green("AI log generation completed!"));
    return content;
  } catch (err) {
    spinner.fail(chalk.red(`Failed to generate AI log entry: ${err}`));
    throw err;
  }
};

/**
 * Analyze cache description for special logging requirements (e.g. upload photo, answer question)
 * Returns a list of requirement strings, or empty array if none found.
 */
export const checkLoggingRequirements = async (cacheDescription: string): Promise<string[]> => {
  if (!cacheDescription.trim()) return [];

  const systemPrompt = `You extract explicit logging requirements from geocache descriptions. A logging requirement is something the cache owner explicitly asks finders to do in order to log the cache — such as uploading a photo, answering a question, posting a word or code, or contacting the owner. Be thorough: if the description mentions ANY action the logger must take, include it. When in doubt, include it.`;

  const prompt = `Read the following geocache description and list every explicit requirement the logger must fulfill (e.g. upload a photo, answer a question, include a specific word, contact the owner, etc.).

Cache description:
---
${cacheDescription}
---

Rules:
- List ONLY what the cache owner explicitly requires from the logger.
- If there are requirements, output them one per line. No bullets, no explanations.
- If there are NO requirements at all, output exactly: NONE`;

  try {
    const content = await chat(prompt, systemPrompt);
    if (!content || content.trim().toUpperCase() === "NONE") return [];
    return content
      .split("\n")
      .map(l => l.trim().replace(/^[-•*]\s*/, ""))
      .filter(Boolean)
      .filter(l => l.toUpperCase() !== "NONE");
  } catch {
    return [];
  }
};

/**
 * Refine existing AI log text using chat history or thread
 */
export const refineLogEntry = async (
  existingLog: string,
  prompt: string,
): Promise<string> => {
  const spinner = ora(chalk.blue("Refining AI-based log text...")).start();

  try {
    const refinePrompt = `
Task: Refine a geocaching log entry.

Language:
- Use the majority language of the prior logs and the existing log.
- Only use German or English.
- If the majority language is neither German nor English, use English.
- If there is no clear majority, prefer the additional notes language if it is German or English; otherwise use English.

Editing goals (very important):
- Keep original voice and facts. Improve clarity, flow, and specificity.
- Remove clichés, emojis, and excessive enthusiasm. At most one exclamation mark.
- Prefer practical, non-cringe wording.

Conciseness rules:
- If the existing log is already short (≤40 words) or inputs are minimal, keep it 20–40 words.
- Otherwise, aim for 40–70 words.

Constraint:
- Do NOT use the abbreviation "TFTC".

Output:
- Only the final refined log text, no headings, no quotes, no explanations.

Existing log:
---
${existingLog}
---

Additional notes:
${prompt}
`;
    let content = await chat(refinePrompt);

    if (!content) {
      const fallbackRefine = `Improve the following geocaching log (~60 words). Keep language and facts, improve clarity and flow, and avoid "TFTC". Output only the refined log text.\n\nLog:\n${existingLog}\n\nAdditional notes:\n${prompt}`;
      content = await chat(fallbackRefine);
    }

    if (!content) {
      content =
        existingLog.replace(/\s+/g, " ").trim() ||
        "Schöner Cache! Kurzer Gruß und Dank an den Owner. (Automatische Verfeinerung nicht verfügbar)";
    }

    spinner.succeed(chalk.green("AI log refinement completed!"));
    return content;
  } catch (err) {
    spinner.fail(chalk.red(`Failed to refine AI log entry: ${err}`));
    throw err;
  }
};
