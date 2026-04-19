// Version-4 (with Cosine Similarity fallback via Python spaCy)
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const { spawnSync } = require('child_process');

// Bloom's taxonomy verbs by category
const bloomsTaxonomyVerbs = {
    "remember": ["recall", "give", "reproduce", "memorize", "define", "identify", "describe", "label", "list", "name", "state", "match", "recognize", "examine", "draw", "write", "locate", "quote", "read", "record", "repeat", "retell", "visualize", "copy", "duplicate", "enumerate", "listen", "observe", "omit", "tabulate", "tell", "what", "why", "when", "where", "which"],
    "understand": ["explain", "how", "interpret", "paraphrase", "summarize", "classify", "compare", "differentiate", "discuss", "distinguish", "extend", "predict", "associate", "contrast", "convert", "demonstrate", "estimate", "identify", "infer", "relate", "restate", "translate", "generalize", "group", "illustrate", "judge", "observe", "order", "report", "represent", "research", "review", "rewrite", "show", "trace"],
    "apply": ["solve", "apply", "modify", "use", "calculate", "change", "demonstrate", "experiment", "relate", "show", "complete", "manipulate", "practice", "simulate", "transfer"],
    "analyze": ["analyze", "analyse", "compare", "classify", "contrast", "distinguish", "infer", "separate", "categorize", "differentiate", "correlate", "deduce", "devise", "dissect", "estimate", "evaluate"],
    "evaluate": ["evaluate", "judge", "assess", "appraise", "critique", "criticize", "discern", "discriminate", "consider", "weigh", "measure", "estimate", "rate", "grade", "score", "rank", "test", "recommend", "decide", "conclude", "argue", "debate", "justify", "persuade", "defend", "support", "summarize", "editorialize", "predict", "distinguish"],
    "create": ["design", "compose", "synthesis", "plan", "combine", "formulate", "invent", "hypothesize", "substitute", "compile", "construct", "develop", "generalize", "integrate", "modify", "organize", "prepare", "produce", "rearrange", "rewrite", "adapt", "arrange", "assemble", "choose", "collaborate", "facilitate", "imagine", "intervene", "manage", "originate", "propose", "simulate", "solve", "support", "test", "validate", "create"]
};

// Bloom's level index map (lower = higher cognitive level)
const bloomLevelMap = {
    "remember":  1,
    "understand": 2,
    "apply":     3,
    "analyze":   4,
    "evaluate":  5,
    "create":    6
};

// ─────────────────────────────────────────────
// Call Python extraction_logic.py via stdin
// Returns { direct: [...], inferred: [...] }
// ─────────────────────────────────────────────
function extractVerbsPythonBatch(questionsArray) {

    // const pythonPath = '/media/pratik/New Volume/jfklds/QuestionPaperQuality_MP3/python-task/myenv/bin/python';
    const pythonPath = 'python3'; 
    const scriptPath = path.join(
        __dirname,
        'extraction_logic_temp.py'
    );
 
    
    const result = spawnSync(pythonPath, [scriptPath], {
        input: JSON.stringify(questionsArray),
        encoding: 'utf-8',
        timeout: 60000       // 60 second timeout for the batch
    });

    if (result.error) {
        console.error('Python spawn error:', result.error.message);
        return questionsArray.map(() => ({ direct: [], inferred: [] }));
    }

    if (result.stderr && result.stderr.trim()) {
        console.warn('Python stderr:', result.stderr.trim());
    }

    if (!result.stdout || !result.stdout.trim()) {
        return questionsArray.map(() => ({ direct: [], inferred: [] }));
    }

    try {
        const parsed = JSON.parse(result.stdout.trim());
        if (Array.isArray(parsed)) return parsed;
        return questionsArray.map(() => ({ direct: [], inferred: [] }));
    } catch (err) {
        console.error('Failed to parse Python output:', err);
        return questionsArray.map(() => ({ direct: [], inferred: [] }));
    }
}

// ─────────────────────────────────────────────
// Helper: find Bloom level name for a word
// ─────────────────────────────────────────────
function findBloomLevel(word) {
    for (const level in bloomsTaxonomyVerbs) {
        if (bloomsTaxonomyVerbs[level].includes(word)) {
            return level;
        }
    }
    return "Not Found";
}

// ─────────────────────────────────────────────
// Helper: convert level name to numeric index
// ─────────────────────────────────────────────
function getBloomLevelIndex(level) {
    const mappedLevel = bloomLevelMap[level];
    if (mappedLevel === undefined) {
        console.warn(`Warning: Bloom level "${level}" not found in bloomLevelMap, defaulting to 6`);
        return 6;
    }
    return mappedLevel;
}

// ─────────────────────────────────────────────
// Analyze a question text for Bloom's level
// using JS-side dictionary (direct word match)
// ─────────────────────────────────────────────
exports.FindBloomLevelsInText = (text) => {
    const words = text.split(/\W+/);
    const wordResult   = [];
    const levelResult  = [];
    let highestLevel   = Infinity;   // ← FIXED: was incorrectly set to 7 before
    let highestVerb    = null;

    for (const word of words) {
        const lowerWord = word.toLowerCase();
        const level     = findBloomLevel(lowerWord);

        if (level !== "Not Found") {
            const levelIndex = getBloomLevelIndex(level);
            wordResult.push(word);
            levelResult.push(levelIndex);

            if (levelIndex < highestLevel) {
                highestLevel = levelIndex;
                highestVerb  = word;
            }
        }
    }

    // No Bloom verbs found at all
    if (highestLevel === Infinity) {
        console.warn(`Warning: No Bloom verbs found in: "${text.substring(0, 60)}..."`);
        return {
            words:        "None",
            levels:       "None",
            highestLevel: null,   // null = unresolved, Python inferred result will fill this
            highestVerb:  null
        };
    }

    return {
        words:        wordResult.join(", "),
        levels:       levelResult.join(", "),
        highestLevel,
        highestVerb
    };
};

// ─────────────────────────────────────────────
// Resolve final Bloom level when JS finds nothing
// Uses inferred results from Python cosine similarity
// ─────────────────────────────────────────────
function resolveBloomLevelFromInferred(inferred) {
    if (!inferred || inferred.length === 0) {
        return {
            highestLevel: "Unclassified",
            highestVerb:  "N/A",
            resolvedBy:   "none"
        };
    }

    // Among all inferred verbs, pick the one with highest similarity score
    const best = inferred.reduce((prev, curr) => {
        const prevIndex = getBloomLevelIndex(prev.level);
        const currIndex = getBloomLevelIndex(curr.level);

        // Prefer higher cognitive level (lower index), break ties by similarity score
        if (currIndex < prevIndex) return curr;
        if (currIndex === prevIndex && curr.score > prev.score) return curr;
        return prev;
    });

    return {
        highestLevel: getBloomLevelIndex(best.level),
        highestVerb:  `${best.verb} (≈${best.matchedTo}, score:${best.score})`,
        resolvedBy:   "cosine-similarity"
    };
}

// ─────────────────────────────────────────────
// Main export: read Excel, process each row
// ─────────────────────────────────────────────
exports.Structurize = (data, inputFile) => {
    return new Promise((resolve, reject) => {
        try {
            const workbook  = xlsx.readFile(inputFile);
            const sheetName = workbook.SheetNames[0];
            const sheet     = workbook.Sheets[sheetName];

            const tableData = xlsx.utils.sheet_to_json(sheet, { defval: '' });

            const questionsArray = tableData.map(row => 
                row.question || row.Question || row.QUESTION || ''
            );

            // Process all Python NLP requests in one batch ──
            const pythonBatchResults = extractVerbsPythonBatch(questionsArray);

            const StructurizedData = tableData.map((row, rowIndex) => {
                const questionText = questionsArray[rowIndex];

                if (!questionText || !questionText.trim()) {
                    console.warn(`Row ${rowIndex + 1}: Missing question text, skipping.`);
                    return null;
                }

                const moduleNumber = row.Module !== undefined && row.Module !== null
                    ? String(row.Module).trim()
                    : 'N/A';

                // ── Step 1: JS dictionary-based Bloom analysis ──
                const bloom = exports.FindBloomLevelsInText(questionText);

                // ── Step 2: Python spaCy extraction (direct + inferred) ──
                const { direct = [], inferred = [] } = pythonBatchResults[rowIndex] || { direct: [], inferred: [] };

                // ── Step 3: Resolve final level ──
                let finalLevel, finalVerb, resolvedBy;

                if (bloom.highestLevel !== null) {
                    // JS found a direct match — use it as primary
                    finalLevel  = bloom.highestLevel;
                    finalVerb   = bloom.highestVerb;
                    resolvedBy  = "dictionary";
                } else {
                    // JS found nothing — fallback to cosine similarity result
                    const resolved = resolveBloomLevelFromInferred(inferred);
                    finalLevel  = resolved.highestLevel;
                    finalVerb   = resolved.highestVerb;
                    resolvedBy  = resolved.resolvedBy;
                }

                // ── Step 4: Build readable inferred verb summary ──
                const inferredSummary = inferred.length > 0
                    ? inferred.map(v =>
                        `${v.verb} → ${v.matchedTo} [${v.level}] (score: ${v.score})`
                      ).join(' | ')
                    : "None";

                // ── Step 5: Return annotated row ──
                return {
                    ...row,
                    "Module":                     moduleNumber,
                    "Bloom's Verbs (JS)":         bloom.words,
                    "Direct Verbs (spaCy)":       direct.map(v => `${v.verb}[${v.level}]`).join(', ') || "None",
                    "Inferred Verbs (Cosine)":    inferredSummary,
                    "Bloom's Taxonomy Level":     finalLevel,
                    "Bloom's Highest Verb":       finalVerb,
                    "Resolved By":                resolvedBy
                };

            }).filter(row => row !== null);

            resolve(StructurizedData);

        } catch (error) {
            reject(`Error processing the file: ${error.message}`);
        }
    });
};