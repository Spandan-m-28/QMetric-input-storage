const { google } = require("googleapis");
const stream = require("stream");

// OAuth client (personal Gmail)
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

// Attach refresh token
oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

async function uploadUserBackup(user) {
  const drive = google.drive({
    version: "v3",
    auth: oauth2Client,
  });

  const fileName = `user_${user._id}.json`;

  const bufferStream = new stream.PassThrough();
  bufferStream.end(
    JSON.stringify(
      {
        userId: user._id,
        userName: user.userName,
        email: user.email,
        createdAt: user.createdAt,
      },
      null,
      2
    )
  );

  await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [process.env.GDRIVE_USER_BACKUP_FOLDER_ID], 
    },
    media: {
      mimeType: "application/json",
      body: bufferStream,
    },
  });

  console.log("✅ Stored inside qmetric/user:", fileName);
}


module.exports = uploadUserBackup;
