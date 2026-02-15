async function ensureFolderExists(drive, folderName, parentId) {
  const query = `
    mimeType='application/vnd.google-apps.folder' 
    and name='${folderName}' 
    and '${parentId}' in parents 
    and trashed=false
  `;

  const res = await drive.files.list({
    q: query,
    fields: "files(id, name)",
  });

  if (res.data.files.length > 0) {
    return res.data.files[0].id; // Folder already exists
  }

  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });

  return folder.data.id;
}

module.exports = ensureFolderExists;