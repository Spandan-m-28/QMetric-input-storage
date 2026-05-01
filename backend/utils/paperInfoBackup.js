const path = require("path");

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

  // 3️⃣ Subject folder
  const subjectFolderName = (paper["Course Name"] || "unknown_subject")
    .toLowerCase()
    .replace(/\s+/g, "");

  const subjectFolderId = await ensureFolderExists(
    drive,
    subjectFolderName,
    collegeFolderId
  );

  // 4️⃣ Extract file extension & mimeType dynamically
  const ext = path.extname(file.originalname); // .pdf, .xlsx, .png etc
  const mimeType = file.mimetype; // comes from multer

  const teacher = (paper["Course Teacher"] || "unknown")
    .toLowerCase()
    .replace(/\s+/g, "");

  const year = paper["Year Of Study"] || new Date().getFullYear();

  const fileName = `${teacher}_${year}${ext}`;

  // 5️⃣ Stream
  const bufferStream = new stream.PassThrough();
  bufferStream.end(fs.readFileSync(file.path));

  // 6️⃣ Upload
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