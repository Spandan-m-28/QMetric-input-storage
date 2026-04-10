const oauth2Client = require("../services/driveClient");
const { google } = require("googleapis");
const stream = require("stream");
const fs = require("fs");
const ensureFolderExists = require("./createCollegeFolder");

async function uploadPaperBackup(file, paper) {
  const drive = google.drive({
    version: "v3",
    auth: oauth2Client,
  });

  const mainFolderId = process.env.GDRIVE_PAPER_BACKUP_FOLDER_ID;

  // 1️⃣ PaperInfo folder
  const paperBackupFolderId = await ensureFolderExists(
    drive,
    "PaperInfo",
    mainFolderId
  );

  // 2️⃣ College folder
  const collegeFolderName = (paper["College Name"] || "unknown_college")
    .toLowerCase()
    .replace(/\s+/g, "");

  const collegeFolderId = await ensureFolderExists(
    drive,
    collegeFolderName,
    paperBackupFolderId
  );

  // 3️⃣ Subject folder (Course Name)
  const subjectFolderName = (paper["Course Name"] || "unknown_subject")
    .toLowerCase()
    .replace(/\s+/g, "");

  const subjectFolderId = await ensureFolderExists(
    drive,
    subjectFolderName,
    collegeFolderId
  );

  // 4️⃣ File name
  const teacher = (paper["Course Teacher"] || "unknown")
    .toLowerCase()
    .replace(/\s+/g, "");

  const year = paper["Year Of Study"] || new Date().getFullYear();

  const fileName = `${teacher}_${year}.xlsx`;

  // 5️⃣ Read file from disk
  const bufferStream = new stream.PassThrough();
  bufferStream.end(fs.readFileSync(file.path));

  // 6️⃣ Upload to Drive
  await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [subjectFolderId],
    },
    media: {
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: bufferStream,
    },
  });

  console.log("✅ Excel uploaded:", fileName);
}

module.exports = uploadPaperBackup;