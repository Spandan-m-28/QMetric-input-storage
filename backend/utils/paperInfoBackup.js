const oauth2Client = require("../services/driveClient");
const { google } = require("googleapis");
const stream = require("stream");
const ensureFolderExists = require("./createCollegeFolder")

async function uploadPaperBackup(paper) {
  const drive = google.drive({
    version: "v3",
    auth: oauth2Client,
  });

  const mainFolderId = process.env.GDRIVE_PAPER_BACKUP_FOLDER_ID;

  // 1️⃣ Ensure "paperinfo backup" folder exists
  const paperBackupFolderId = await ensureFolderExists(
    drive,
    "PaperInfo",
    mainFolderId
  );

  // 2️⃣ Format college name (lowercase + no spaces)
  const collegeFolderName = paper["College Name"]
    .toLowerCase()
    .replace(/\s+/g, "");

  // 3️⃣ Ensure college folder exists
  const collegeFolderId = await ensureFolderExists(
    drive,
    collegeFolderName,
    paperBackupFolderId
  );

  // 4️⃣ File name
  const fileName = `paper_${paper._id}.json`;

  const bufferStream = new stream.PassThrough();
  bufferStream.end(JSON.stringify(paper, null, 2));

  // 5️⃣ Upload paper file
  await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [collegeFolderId],
    },
    media: {
      mimeType: "application/json",
      body: bufferStream,
    },
  });

  console.log("✅ Paper backup stored:", fileName);
}

module.exports = uploadPaperBackup;
