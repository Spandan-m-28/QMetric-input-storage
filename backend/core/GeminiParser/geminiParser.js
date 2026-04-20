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
RULE 1 — MULTI-PART QUESTIONS (sub-parts with individual marks):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Some questions have sub-parts (i)(ii)(iii) that each carry individual marks:

  Q2 A) Consider the relation R(A,B,C,D,E)...         CO2
        (i)  Is AB a candidate Key? Justify.   (1 Mark)
        (ii) Find whether R is in 3NF or BCNF. (2 Mark)
        (iii) Is the decomposition lossless?   (2 Mark)

→ Keep as ONE entry. Combine all sub-parts into one "questionText".
→ marks = sum of all sub-part marks (1+2+2 = 5).
→ DO NOT create separate entries for (i), (ii), (iii).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 2 — TABLE FORMAT (marks on parent row, shared among sub-questions):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Some papers use a TABLE where marks appear on the parent row, not per sub-question:

  Q1   Answer the following              5      ← total marks for this group
       A) Write the full form of ETP.         CO1
       B) Define air pollution.               CO3
       C) Explain light pollution.            CO1
       D) What is acid rain?                  CO2
       E) Name any two case studies of EIA.   CO5

→ Each sub-question (A, B, C, D, E) is a SEPARATE entry in the JSON.
→ Distribute parent marks equally: 5 marks ÷ 5 sub-questions = 1 mark each.
→ Each entry gets: marks = round(parentMarks / numberOfSubQuestions).
→ If division is uneven, give extra mark to first sub-question.

  Q2   Answer the following              10     ← total marks for this group
       A) Explain importance of EIA.          CO1
       B) Differentiate renewable resources.  CO3
       C) Draw diagram of energy pyramid.     CO2
       D) Define biodiversity.                CO4
       E) Match the following.                CO1

→ 10 marks ÷ 5 sub-questions = 2 marks each.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 3 — MARKS EXTRACTION PRIORITY ORDER:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Use this priority order to determine marks for each question:

1. Individual marks written next to the question → use that number directly.
2. Marks in brackets like [5M], (2 Mark), (1 mark) → use that number.
3. Sub-parts (i)(ii)(iii) with own marks → sum them all up (Rule 1).
4. Parent row has total marks, sub-questions have none → divide equally (Rule 2).
5. Truly cannot determine → use null.

NEVER return 0 for marks. Either find the correct number or return null.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHAT TO IGNORE COMPLETELY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- College name, address, logo
- PRN field, date, time, max marks header
- Instruction lines starting with a), b), c)...
- "Answer the following" parent headings — extract only the actual sub-questions under them
- Page numbers
- Match-the-column filler rows (Column A/B headers and their value rows —
  keep the "Match the following" question itself as one entry with distributed marks)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FOR EACH REAL QUESTION EXTRACT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- "questionId": Label from paper — "Q1A", "Q1B", "Q2A" etc.
  If no sub-labels exist use "Q1", "Q2" etc.

- "questionText": Full question text. For Rule 1 combine all sub-parts into one string.
  For Rule 2 keep each sub-question as a separate entry.

- "marks": A positive number. NEVER 0. Use null only if truly unknown after all rules above.

- "co": "CO1", "CO2" etc from right side of row. null if not found.

- "module": Module number if mentioned (M1, Module 1 etc.), else null.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return ONLY a valid JSON array. No explanation. No markdown. No code blocks.
Start directly with [ and end with ]

Example 1 — Table format paper (Rule 2):
Q1 has 5 total marks, 5 sub-questions → 1 mark each
Q2 has 10 total marks, 5 sub-questions → 2 marks each
[
  {"questionId":"Q1A","questionText":"Write the full form of ETP and STP.","marks":1,"co":"CO1","module":null},
  {"questionId":"Q1B","questionText":"Define air pollution with example of air pollutants.","marks":1,"co":"CO3","module":null},
  {"questionId":"Q1C","questionText":"Explain what light pollution is in single sentence.","marks":1,"co":"CO1","module":null},
  {"questionId":"Q1D","questionText":"What is acid rain?","marks":1,"co":"CO2","module":null},
  {"questionId":"Q1E","questionText":"Name any two case studies of EIA.","marks":1,"co":"CO5","module":null},
  {"questionId":"Q2A","questionText":"Explain the importance and objectives of EIA in engineering projects.","marks":2,"co":"CO1","module":null},
  {"questionId":"Q2B","questionText":"Differentiate between renewable and non-renewable resources with examples.","marks":2,"co":"CO3","module":null},
  {"questionId":"Q2C","questionText":"Draw a neat and labeled diagram of energy pyramid.","marks":2,"co":"CO2","module":null},
  {"questionId":"Q2D","questionText":"Define biodiversity and list its three main types.","marks":2,"co":"CO4","module":null},
  {"questionId":"Q2E","questionText":"Match the following.","marks":2,"co":"CO1","module":null}
]

Example 2 — Sub-parts with individual marks (Rule 1):
[
  {"questionId":"Q1A","questionText":"Explain following constructs in ER Diagram. (i) Total and Partial Participation (ii) Minimum and maximum Cardinality","marks":4,"co":"CO1","module":null},
  {"questionId":"Q2A","questionText":"Consider R(A,B,C,D,E) with F={AB->C, D->E, A->D}. (i) Is AB a candidate Key? Justify. (ii) Find whether R is in 3NF or BCNF. (iii) Is decomposition into R1(A,B,C) and R2(A,D,E) lossless? Justify.","marks":5,"co":"CO2","module":null}
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

      // Safety net: replace any 0 marks with null (0 is never a valid exam mark)
      questions.forEach((q) => {
        if (q.marks === 0) q.marks = null;
      });

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