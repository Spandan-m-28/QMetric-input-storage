var express = require('express');
var router = express.Router();
const authenticateToken = require('../core/auth/utilities');
let fileController = require("../controllers/fileController");
const multer = require('multer');
const path = require('path');
const os = require('os');

// ── Shared disk storage (works on both Windows and Linux) ──────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (req, file, cb) => {
    const fileExt = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + fileExt);
  },
});

// ── Multer instance for Excel / CSV / text PDF (existing flow) ─────────────
const upload = multer({ storage: storage });

// ── Multer instance for Gemini flow: scanned PDF + images ──────────────────
const uploadPDFOrImage = multer({
  storage: storage,   // same storage, different mime filter
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, JPG, and PNG files are allowed for this route'), false);
    }
  },
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB max
  },
});

// ── Routes ─────────────────────────────────────────────────────────────────

// Existing Excel / CSV / digital PDF route (unchanged)
router.post('/totext', authenticateToken, upload.single('file'), fileController.convertToText);
router.get('/totext', authenticateToken, fileController.getResults);

// NEW: Scanned PDF / image route → processed by Gemini AI
router.post('/pdf', authenticateToken, uploadPDFOrImage.single('file'), fileController.convertPDFOrImageToText);

router.get('/all', authenticateToken, fileController.getResultsById);
router.post('/search', authenticateToken, fileController.searchPapers);

router.get('/test', (req, res) => {
  res.send('File route is working!');
});

module.exports = router;