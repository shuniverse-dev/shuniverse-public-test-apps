import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const appSlug = process.env.APP_SLUG;
const userPrompt = process.env.PUBLIC_DEPLOY_PROMPT;
const deployMode = process.env.PUBLIC_DEPLOY_MODE || "standard";
const model = process.env.OPENAI_MODEL || "gpt-5.2";
const apiKey = process.env.OPENAI_API_KEY;

if (!appSlug || !/^[a-z0-9-]+$/.test(appSlug)) {
  throw new Error("APP_SLUG must contain only lowercase letters, digits, and hyphens.");
}

if (!userPrompt || userPrompt.trim().length < 10) {
  throw new Error("PUBLIC_DEPLOY_PROMPT is required.");
}

if (!apiKey) {
  throw new Error("OPENAI_API_KEY is required.");
}

if (!["standard", "mobile"].includes(deployMode)) {
  throw new Error("PUBLIC_DEPLOY_MODE must be standard or mobile.");
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["index_html", "style_css", "script_js"],
  properties: {
    index_html: { type: "string" },
    style_css: { type: "string" },
    script_js: { type: "string" }
  }
};

const instructions = [
  "Generate a complete static browser app for deployment under a URL subpath.",
  "Return only JSON matching the provided schema.",
  "The app must be self-contained and must use exactly three files: index.html, style.css, script.js.",
  "Use relative file references: style.css and script.js.",
  "Do not use external CDN scripts, external images, analytics, trackers, secrets, API keys, or server calls.",
  "Use accessible, responsive HTML/CSS/JS.",
  "If the request is for a game, make it immediately playable with keyboard and/or pointer controls as requested.",
  "Avoid instructions text as filler; build the actual usable experience as the first screen.",
  deployMode === "mobile" ? [
    "This is PUBLIC MOBILE DEPLOY mode.",
    "Design mobile-first for phone screens before desktop.",
    "Use large touch targets of at least 48 CSS pixels.",
    "Avoid hover-only interactions.",
    "Keep primary controls visible without requiring a keyboard.",
    "For games, provide touch/tap controls and prevent page scrolling during play where appropriate.",
    "Make text fit within buttons and panels on narrow screens."
  ].join(" ") : [
    "This is PUBLIC DEPLOY mode.",
    "Make the app responsive across desktop and mobile, but prioritize the requested interaction style."
  ].join(" ")
].join("\n");

const body = {
  model,
  instructions,
  input: `Create this static app:\n\n${userPrompt}\n\nDeploy mode: ${deployMode}\nDeploy slug: ${appSlug}`,
  max_output_tokens: 12000,
  text: {
    format: {
      type: "json_schema",
      name: "static_app_files",
      strict: true,
      schema
    }
  }
};

const response = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(body)
});

if (!response.ok) {
  const errorText = await response.text();
  throw new Error(`OpenAI API request failed: ${response.status} ${errorText}`);
}

const data = await response.json();
const outputText = data.output_text || collectOutputText(data.output);

if (!outputText) {
  throw new Error("OpenAI response did not contain output text.");
}

let files;
try {
  files = JSON.parse(outputText);
} catch (error) {
  throw new Error(`Generated output was not valid JSON: ${error.message}`);
}

validateFile("index_html", files.index_html);
validateFile("style_css", files.style_css);
validateFile("script_js", files.script_js);

if (!files.index_html.includes("style.css") || !files.index_html.includes("script.js")) {
  throw new Error("index.html must reference style.css and script.js.");
}

const targetDir = path.resolve(appSlug);
await mkdir(targetDir, { recursive: true });
await writeFile(path.join(targetDir, "index.html"), normalize(files.index_html));
await writeFile(path.join(targetDir, "style.css"), normalize(files.style_css));
await writeFile(path.join(targetDir, "script.js"), normalize(files.script_js));

console.log(`Generated static app in ${targetDir}`);

function collectOutputText(output) {
  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .filter((content) => content.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("");
}

function validateFile(name, value) {
  if (typeof value !== "string" || value.trim().length < 20) {
    throw new Error(`${name} must be a non-empty string.`);
  }
}

function normalize(value) {
  return value.replace(/\r\n/g, "\n").trim() + "\n";
}
