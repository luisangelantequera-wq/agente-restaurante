const BACKUP_FOLDER_NAME = "Contactia Backups";
const BACKUP_FILE_PATTERN = /^contactia-backup-\d{4}-\d{2}-\d{2}\.json\.enc$/;
const MAX_CONTENT_LENGTH = 9 * 1024 * 1024;


function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


function getOrCreateBackupFolder() {
  const folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  return folders.hasNext()
    ? folders.next()
    : DriveApp.createFolder(BACKUP_FOLDER_NAME);
}


function deleteExpiredBackups(folder, retentionDays) {
  const limit = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const files = folder.getFiles();

  while (files.hasNext()) {
    const file = files.next();

    if (
      BACKUP_FILE_PATTERN.test(file.getName()) &&
      file.getDateCreated().getTime() < limit
    ) {
      file.setTrashed(true);
    }
  }
}


function deleteExistingFile(folder, filename) {
  const files = folder.getFilesByName(filename);

  while (files.hasNext()) {
    files.next().setTrashed(true);
  }
}


function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || "{}");
    const expectedSecret = PropertiesService
      .getScriptProperties()
      .getProperty("BACKUP_UPLOAD_SECRET");
    const retentionDays = Math.min(
      7,
      Math.max(1, Number(data.retention_days) || 7)
    );

    if (!expectedSecret || data.secret !== expectedSecret) {
      return jsonResponse({ ok: false, error: "No autorizado." });
    }

    if (!BACKUP_FILE_PATTERN.test(String(data.filename || ""))) {
      return jsonResponse({ ok: false, error: "Nombre de archivo no válido." });
    }

    if (
      typeof data.content !== "string" ||
      data.content.length === 0 ||
      data.content.length > MAX_CONTENT_LENGTH
    ) {
      return jsonResponse({ ok: false, error: "Contenido no válido." });
    }

    const folder = getOrCreateBackupFolder();

    deleteExistingFile(folder, data.filename);
    const file = folder.createFile(
      data.filename,
      data.content,
      MimeType.PLAIN_TEXT
    );
    deleteExpiredBackups(folder, retentionDays);

    return jsonResponse({ ok: true, file_id: file.getId() });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: "No se pudo guardar la copia." });
  }
}

