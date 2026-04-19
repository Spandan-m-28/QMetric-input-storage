const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Models tried in order:
// gemini-3.1-pro-preview → Pro subscription (best accuracy)
// gemini-2.5-flash-lite  → free tier, 1000 req/day
// gemini-2.5-flash       → free tier, 250 req/day
// gemini-2.5-pro         → free tier, 100 req/day
const MODEL_FALLBACK_LIST = [
  "gemini-3.1-pro-preview",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
];

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    ".pdf":  "application/pdf",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
  };
  return mimeMap[ext] || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryModel(modelName, base64, mimeType, prompt) {
  const model = genAI.getGenerativeModel({ model: modelName });
  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: prompt },
        ],
      },
    ],
  });
  return result;
}

function buildPrompt() {
  return `
You are an academic question paper analyzer for Indian engineering universities.

Your task: extract questions from this paper into a structured JSON array.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RULE — MULTI-PART QUESTIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Indian university question papers often have questions like:

  Q2 A) Consider the relation R(A,B,C,D,E)...         CO2
        (i)  Is AB a candidate Key? Justify.   (1 Mark)
        (ii) Find whether R is in 3NF or BCNF. (2 Mark)
        (iii) Is the decomposition lossless?   (2 Mark)

This is ONE question (Q2A) with sub-parts (i), (ii), (iii).
You MUST keep it as a SINGLE entry in the JSON array.
Combine the parent question AND all its sub-parts into one "questionText".
The total marks = sum of sub-part marks (1+2+2 = 5).

DO NOT create separate entries for (i), (ii), (iii) — they belong to the same question.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHAT TO IGNORE COMPLETELY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- College name, address, logo
- PRN field, date, time, max marks header
- Instruction lines starting with a), b), c)...
- "Answer the following" parent headings with no question text
- Page numbers
- Match-the-column filler rows (Column A/B headers and value rows —
  keep the "Match the following" question itself as one entry)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FOR EACH REAL QUESTION EXTRACT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- "questionId": Label from paper — "Q1A", "Q1B", "Q2A" etc. No sub-labels → "Q1", "Q2".
- "questionText": Full combined text including all sub-parts (i)(ii)(iii) as one string.
- "marks": Total marks (sum sub-parts if needed). null if not found.
- "co": "CO1", "CO2" etc from right side of row. null if not found.
- "module": Module number if mentioned, else null.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return ONLY a valid JSON array. No explanation. No markdown. No code blocks.
Start directly with [ and end with ]

Example (8 raw lines in paper → 6 questions in output):
[
  {"questionId":"Q1A","questionText":"Explain following constructs in ER Diagram with suitable example and Diagram. (i) Total and Partial Participation (ii) Minimum and maximum Cardinality","marks":4,"co":"CO1","module":null},
  {"questionId":"Q1B","questionText":"What are the responsibilities of database administrators?","marks":3,"co":"CO1","module":null},
  {"questionId":"Q1C","questionText":"Construct an E-R diagram for a hospital with a set of patients and a set of medical doctors. Associate with each patient a log of the various tests and examinations conducted.","marks":3,"co":"CO2","module":null},
  {"questionId":"Q2A","questionText":"Consider the relation R(A,B,C,D,E) with F={AB->C, D->E, A->D}. (i) Is AB a candidate Key? Justify. (ii) Find whether R is in 3NF or BCNF with reasons. (iii) Is the decomposition into R1(A,B,C) and R2(A,D,E) lossless and dependency preserving? Justify.","marks":5,"co":"CO2","module":null},
  {"questionId":"Q2B","questionText":"Explain Referential Integrity constraint with example.","marks":3,"co":"CO1","module":null},
  {"questionId":"Q2C","questionText":"Consider the employee database schema given below, where the primary keys are underlined.","marks":2,"co":"CO1","module":null}
]
`;
}

async function extractQuestionsFromFile(filePath, providedMimeType = null) {
  const mimeType = providedMimeType || getMimeType(filePath);

  if (!mimeType) {
    throw new Error("Unsupported file type. Only PDF, JPG, PNG are allowed.");
  }

  const fileData = fs.readFileSync(filePath);
  const base64 = fileData.toString("base64");
  const prompt = buildPrompt();

  for (const modelName of MODEL_FALLBACK_LIST) {
    try {
      console.log(`🤖 Trying Gemini model: ${modelName}`);
      const result = await tryModel(modelName, base64, mimeType, prompt);

      const responseText = result?.response?.text?.();
      if (!responseText) throw new Error("Empty response from Gemini");

      const clean = responseText.replace(/```json|```/g, "").trim();
      const jsonMatch = clean.match(/\[[\s\S]*\]/);

      if (!jsonMatch) throw new Error("Gemini did not return a valid JSON array");

      const questions = JSON.parse(jsonMatch[0]);

      if (!Array.isArray(questions) || questions.length === 0) {
        throw new Error("No questions extracted from the file");
      }

      console.log(`✅ Extracted ${questions.length} questions using ${modelName}`);
      return questions;

    } catch (err) {
      const isQuotaError =
        err.status === 429 ||
        err.message?.includes("429") ||
        err.message?.includes("quota") ||
        err.message?.includes("Too Many Requests");

      const isNotFound =
        err.status === 404 ||
        err.message?.includes("404") ||
        err.message?.includes("not found");

      if (isQuotaError || isNotFound) {
        console.warn(`⚠️  ${modelName} unavailable. Trying next model...`);
        await sleep(1500);
        continue;
      }

      throw err;
    }
  }

  throw new Error(
    "All Gemini models are currently unavailable. " +
    "Free tier quota exhausted — please wait and retry, or enable billing at https://aistudio.google.com"
  );
}

module.exports = { extractQuestionsFromFile };