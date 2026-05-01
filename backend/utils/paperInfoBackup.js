const { google } = require("googleapis");
const stream = require("stream");
const fs = require("fs");
const oauth2Client = require("../services/driveClient");
const ensureFolderExists = require("./createCollegeFolder");
const path = require("path");

async function uploadPaperBackup(file, paper) {
  const drive = google.drive({
    version: "v3",
    auth: oauth2Client,
  });

  const mainFolderId = process.env.GDRIVE_PAPER_BACKUP_FOLDER_ID;

  const paperBackupFolderId = await ensureFolderExists(
    drive,
    "PaperInfo",
    mainFolderId
  );

  const collegeFolderName = (paper["College Name"] || "unknown_college")
    .toLowerCase()
    .replace(/\s+/g, "");

  const collegeFolderId = await ensureFolderExists(
    drive,
    collegeFolderName,
    paperBackupFolderId
  );

  const subjectFolderName = (paper["Course Name"] || "unknown_subject")
    .toLowerCase()
    .replace(/\s+/g, "");

  const subjectFolderId = await ensureFolderExists(
    drive,
    subjectFolderName,
    collegeFolderId
  );

  const ext = path.extname(file.originalname);
  const mimeType = file.mimetype;

  const teacher = (paper["Course Teacher"] || "unknown")
    .toLowerCase()
    .replace(/\s+/g, "");

  const year = paper["Year Of Study"] || new Date().getFullYear();

  const fileName = `${teacher}_${year}${ext}`;

  const bufferStream = new stream.PassThrough();
  bufferStream.end(fs.readFileSync(file.path));

  await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [subjectFolderId],
    },
    media: {
      mimeType: mimeType,
      body: bufferStream,
    },
  });

  console.log("✅ File uploaded:", fileName);
}

module.exports = uploadPaperBackup;