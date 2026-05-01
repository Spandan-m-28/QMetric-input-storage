//version2
const path = require("path");
const fs = require("fs");
const {
  Structurize,
  FindBloomLevelsInText,
} = require("../core/Regex/regex_temp.js");
const PaperInfo = require("../Model/PaperInfo");
const { Evaluate } = require("../core/evaluate/evaluate");
const uploadPaperBackup = require("../utils/paperInfoBackup");

exports.convertToText = async (req, res) => {
  if (!req.file) {
    return res.status(400).send({ error: "No file uploaded." });
  }

  const { userId } = req.user;

  const inputFileName = req.file.originalname;
  const fileExtension = path.extname(inputFileName).toLowerCase();
  const supportedExtensions = [".xlsx", ".pdf", ".csv"];

  if (!supportedExtensions.includes(fileExtension)) {
    return res.status(400).send({
      error: "Invalid File Format",
      message:
        "Only Excel files (.xlsx), CSV files, and Digital text PDFs are supported.",
    });
  }

  try {
    const outputDir = path.join(__dirname, "../Converted");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const result = await saveToDB(
      userId,
      req.body.Sequence,
      req.body.FormData,
      req.file,
    );

    if (result.error) {
      return res.status(result.statusCode || 500).send(result);
    }

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("Error during conversion or DB save:", error);
    return res
      .status(500)
      .send({ error: "Server error while processing file" });
  }
};

const saveToDB = async (userId, Sequence, FormData, file) => {
  try {
    let sequenceArray, formData;

    try {
      sequenceArray = JSON.parse(Sequence);
      formData = JSON.parse(FormData);
    } catch (parseErr) {
      console.error("Error parsing JSON:", parseErr);
      return { error: "Invalid JSON in Sequence or FormData" };
    }

    const coWeights = {};
    const moduleHours = {};
    const coDetails = {};

    sequenceArray.forEach((item) => {
      const match = item.name.match(/\d+/);
      if (!match) return;

      const number = match[0];

      if (item.type === "CO") {
        const coKey = `CO${number}`;
        const weight = parseFloat(item.weight || 0);

        const blooms = Array.isArray(item.blooms)
          ? item.blooms
              .filter((b) => typeof b === "string")
              .map((b) => b.toLowerCase())
          : typeof item.blooms === "string"
            ? [item.blooms.toLowerCase()]
            : [];

        coWeights[coKey] = weight;
        coDetails[coKey] = { weight, blooms };
      } else if (item.type === "Module") {
        moduleHours[`M${number}`] = parseFloat(item.hours || 0);
      }
    });

    const allBloomLevels = [
      "create",
      "evaluate",
      "analyze",
      "apply",
      "understand",
      "remember",
    ];
    const bloomLevelMap = {};
    const usedBloomLevels = new Set();

    Object.values(coDetails).forEach((data) => {
      const bloom = (data.blooms[0] || "").toLowerCase();
      if (bloom && allBloomLevels.includes(bloom)) usedBloomLevels.add(bloom);
    });

    const sortedUsedBlooms = allBloomLevels.filter((level) =>
      usedBloomLevels.has(level),
    );
    sortedUsedBlooms.forEach((bloom, index) => {
      bloomLevelMap[bloom] = index + 1;
    });

    let nextLevel = sortedUsedBlooms.length + 1;
    allBloomLevels.forEach((level) => {
      if (!bloomLevelMap[level] && nextLevel <= 6) {
        bloomLevelMap[level] = nextLevel;
        nextLevel++;
      }
    });
    allBloomLevels.forEach((level) => {
      if (!bloomLevelMap[level]) bloomLevelMap[level] = 6;
    });

    let questionData = [];
    const filePath = file.path;
    const ext = path.extname(file.originalname).toLowerCase();

    if (ext === ".xlsx" || ext === ".csv") {
      questionData = await Structurize([], filePath, bloomLevelMap);
    } else {
      try {
        const {
          parseTextToVirtualExcel,
        } = require("../core/Parser/VirtualExcelAdapter");
        let rawText = "";

        if (ext === ".pdf") {
          const pdfParse = require("pdf-parse");
          const dataBuffer = fs.readFileSync(filePath);
          const data = await pdfParse(dataBuffer);
          rawText = data.text;

          if (rawText.trim().length < 50) {
            return {
              statusCode: 400,
              error:
                "Only digital text PDFs are supported. Scanned documents cannot be processed.",
            };
          }
        } else {
          return {
            statusCode: 400,
            error: "Unsupported file format for text extraction.",
          };
        }

        questionData = parseTextToVirtualExcel(rawText, bloomLevelMap);

        if (!questionData || questionData.length === 0) {
          return {
            error:
              "Could not extract structured questions from the provided document.",
          };
        }
      } catch (err) {
        console.error("Pipeline Extraction Error:", err);
        return { error: `Pipeline Extraction Failed: ${err.message}` };
      }
    }

    const evaluationResult = Evaluate(
      questionData,
      coDetails,
      moduleHours,
      bloomLevelMap,
    );

    const paper = new PaperInfo({
      "College Name": formData["College Name"],
      Branch: formData.Branch,
      "Year Of Study": formData["Year Of Study"],
      Semester: formData.Semester,
      "Course Name": formData["Course Name"],
      "Course Code": formData["Course Code"],
      "Course Teacher": formData["Course Teacher"],
      Sequence: { COs: coDetails, ModuleHours: moduleHours },
      blommLevelMap: bloomLevelMap,
      "Collected Data": evaluationResult,
      userId: userId,
    });

    await paper.save();

    // Drive backup only works for Excel (needs file on disk) — skip for other formats
    uploadPaperBackup(
      {
        path: file.path,
        originalname: file.originalname,
        mimetype: file.mimetype,
      },
      paper,
    );

    return evaluationResult;
  } catch (error) {
    console.error("Error saving to MongoDB:", error);
    return { error: error.message || "Failed to process and save data" };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Gemini-powered PDF / Image handler → POST /upload/pdf
// ─────────────────────────────────────────────────────────────────────────────
exports.convertPDFOrImageToText = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  const { userId } = req.user;
  const filePath = req.file.path;

  try {
    let sequenceArray, formData;
    try {
      sequenceArray = JSON.parse(req.body.Sequence);
      formData = JSON.parse(req.body.FormData);
    } catch (e) {
      return res
        .status(400)
        .json({ error: "Invalid JSON in Sequence or FormData" });
    }

    const moduleHours = {};
    const coDetails = {};

    sequenceArray.forEach((item) => {
      const match = item.name.match(/\d+/);
      if (!match) return;
      const number = match[0];

      if (item.type === "CO") {
        const coKey = `CO${number}`;
        const blooms = Array.isArray(item.blooms)
          ? item.blooms
              .filter((b) => typeof b === "string")
              .map((b) => b.toLowerCase())
          : typeof item.blooms === "string"
            ? [item.blooms.toLowerCase()]
            : [];
        coDetails[coKey] = { weight: parseFloat(item.weight || 0), blooms };
      } else if (item.type === "Module") {
        moduleHours[`M${number}`] = parseFloat(item.hours || 0);
      }
    });

    const allBloomLevels = [
      "create",
      "evaluate",
      "analyze",
      "apply",
      "understand",
      "remember",
    ];
    const bloomLevelMap = {};
    const usedBloomLevels = new Set();

    Object.values(coDetails).forEach((data) => {
      const bloom = (data.blooms[0] || "").toLowerCase();
      if (bloom && allBloomLevels.includes(bloom)) usedBloomLevels.add(bloom);
    });

    const sortedUsedBlooms = allBloomLevels.filter((l) =>
      usedBloomLevels.has(l),
    );
    sortedUsedBlooms.forEach((bloom, index) => {
      bloomLevelMap[bloom] = index + 1;
    });

    let nextLevel = sortedUsedBlooms.length + 1;
    allBloomLevels.forEach((level) => {
      if (!bloomLevelMap[level])
        bloomLevelMap[level] = nextLevel <= 6 ? nextLevel++ : 6;
    });

    const {
      extractQuestionsFromFile,
    } = require("../core/GeminiParser/geminiParser");
    const extractedQuestions = await extractQuestionsFromFile(
      filePath,
      req.file.mimetype,
    );

    if (!extractedQuestions || extractedQuestions.length === 0) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(422).json({
        error: "No questions could be extracted from this file.",
        hint: "Make sure the file contains clearly numbered exam questions.",
      });
    }

    const validCOs = Object.keys(coDetails);
    const defaultCO = validCOs[0] || "CO1";

    const questionData = extractedQuestions.map((q, index) => {
      const bloom = FindBloomLevelsInText(q.questionText, bloomLevelMap);

      const rawCO = (q.co || "").toString().trim().toUpperCase();
      const safeCO = validCOs.includes(rawCO) ? rawCO : defaultCO;
      const safeModule = q.module ? String(q.module) : "N/A";
      const safeMarks = isNaN(parseFloat(q.marks)) ? 0 : parseFloat(q.marks);

      return {
        "Question No": q.questionId || `Q${index + 1}`,
        Question: q.questionText || "",
        "Question Type": "Descriptive",
        CO: safeCO,
        Marks: safeMarks,
        Module: safeModule,
        "Bloom's Verbs": bloom.words,
        "Bloom's Taxonomy Level": bloom.highestLevel,
        "Bloom's Highest Verb": bloom.highestVerb,
        "Extracted Verbs": bloom.words,
      };
    });

    const evaluationResult = Evaluate(
      questionData,
      coDetails,
      moduleHours,
      bloomLevelMap,
    );

    const paper = new PaperInfo({
      "College Name": formData["College Name"],
      Branch: formData.Branch,
      "Year Of Study": formData["Year Of Study"],
      Semester: formData.Semester,
      "Course Name": formData["Course Name"],
      "Course Code": formData["Course Code"],
      "Course Teacher": formData["Course Teacher"],
      Sequence: { COs: coDetails, ModuleHours: moduleHours },
      blommLevelMap: bloomLevelMap,
      "Collected Data": evaluationResult,
      userId: userId,
    });

    await paper.save();

    await uploadPaperBackup(
      {
        path: filePath,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
      },
      paper,
    );

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    return res.status(200).json({ success: true, data: evaluationResult });
  } catch (error) {
    console.error("❌ Gemini processing error:", error.message);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return res.status(500).json({
      error: "Failed to process file",
      details: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────

exports.getResults = async (req, res) => {
  try {
    const { userId } = req.user || { userId: "anonymous" };

    const userResults = await PaperInfo.find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    if (userResults.length === 0) {
      return res.status(404).json({
        error: "No results found",
        message: "No analysis results found for your account",
      });
    }

    const latestResult = userResults[0];
    const { extractedText, ...responseData } = latestResult;

    res.json({ success: true, data: responseData });
  } catch (error) {
    console.error("Get results error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getResultsById = async (req, res) => {
  try {
    const { userId } = req.user || { userId: "anonymous" };

    const userResults = await PaperInfo.find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    if (userResults.length === 0) {
      return res.status(404).json({
        error: "No results found",
        message: "No analysis results found for your account",
      });
    }

    const results = userResults.map(({ extractedText, ...rest }) => rest);
    res.json({ success: true, data: results });
  } catch (error) {
    console.error("Get results error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.searchPapers = async (req, res) => {
  try {
    const { userId } = req.user;
    const { query } = req.body;

    const searchRegex = new RegExp(query, "i");

    const papers = await PaperInfo.find({
      userId: userId,
      $or: [
        { "College Name": searchRegex },
        { Branch: searchRegex },
        { "Course Name": searchRegex },
        { "Course Code": searchRegex },
      ],
    });

    res.json(papers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
