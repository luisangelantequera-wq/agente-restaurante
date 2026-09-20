const BACKUP_FOLDER_NAME = "Contactia Backups";
const BACKUP_FILE_PATTERN = /^contactia-backup-\d{4}-\d{2}-\d{2}(?:-antes-restaurar-\d{6})?\.json\.enc$/;
const MAX_CONTENT_LENGTH = 9 * 1024 * 1024;
const AUDIO_FOLDER_NAME = "Contactia Audios Temporales";
const AUDIO_FILE_PATTERN = /^contactia-audio-(CONV-[A-Za-z0-9-]{8,84})-(T\d{3})\.json\.enc$/;
const CONVERSATION_ID_PATTERN = /^CONV-[A-Za-z0-9-]{8,84}$/;
const MAX_AUDIO_CONTENT_LENGTH = 4 * 1024 * 1024;


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


function getOrCreateAudioFolder() {
  const folders = DriveApp.getFoldersByName(AUDIO_FOLDER_NAME);
  return folders.hasNext()
    ? folders.next()
    : DriveApp.createFolder(AUDIO_FOLDER_NAME);
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


function deleteExpiredAudios(folder, retentionDays) {
  const limit = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const files = folder.getFiles();
  let deleted = 0;

  while (files.hasNext()) {
    const file = files.next();

    if (
      AUDIO_FILE_PATTERN.test(file.getName()) &&
      file.getDateCreated().getTime() < limit
    ) {
      file.setTrashed(true);
      deleted += 1;
    }
  }

  return deleted;
}


function deleteExistingFile(folder, filename) {
  const files = folder.getFilesByName(filename);

  while (files.hasNext()) {
    files.next().setTrashed(true);
  }
}


function listBackupFiles(folder) {
  const files = folder.getFiles();
  const result = [];

  while (files.hasNext()) {
    const file = files.next();

    if (BACKUP_FILE_PATTERN.test(file.getName())) {
      result.push({
        filename: file.getName(),
        created_at: file.getDateCreated().toISOString(),
        updated_at: file.getLastUpdated().toISOString(),
        size: file.getSize()
      });
    }
  }

  return result
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 50);
}


function readBackupFile(folder, filename) {
  const files = folder.getFilesByName(filename);
  let selected = null;

  while (files.hasNext()) {
    const current = files.next();

    if (
      !selected ||
      current.getDateCreated().getTime() > selected.getDateCreated().getTime()
    ) {
      selected = current;
    }
  }

  if (!selected) {
    throw new Error("La copia solicitada no existe.");
  }

  if (selected.getSize() > MAX_CONTENT_LENGTH) {
    throw new Error("La copia solicitada supera el tamaño permitido.");
  }

  return selected.getBlob().getDataAsString("UTF-8");
}


function readAudioFile(folder, filename) {
  const files = folder.getFilesByName(filename);
  let selected = null;

  while (files.hasNext()) {
    const current = files.next();

    if (
      !selected ||
      current.getDateCreated().getTime() > selected.getDateCreated().getTime()
    ) {
      selected = current;
    }
  }

  if (!selected) {
    throw new Error("El audio solicitado no existe.");
  }

  if (selected.getSize() > MAX_AUDIO_CONTENT_LENGTH) {
    throw new Error("El audio solicitado supera el tamaño permitido.");
  }

  return selected.getBlob().getDataAsString("UTF-8");
}


function deleteAudiosByConversation(folder, conversationIds) {
  const permitted = {};
  let deleted = 0;

  conversationIds.forEach(function(id) {
    permitted[id] = true;
  });

  const files = folder.getFiles();

  while (files.hasNext()) {
    const file = files.next();
    const match = file.getName().match(AUDIO_FILE_PATTERN);

    if (match && permitted[match[1]]) {
      file.setTrashed(true);
      deleted += 1;
    }
  }

  return deleted;
}


function handleAudioAction(data, action) {
  const folder = getOrCreateAudioFolder();

  if (action === "audio_purge_expired") {
    const retentionDays = Math.min(
      30,
      Math.max(1, Number(data.retention_days) || 30)
    );

    return jsonResponse({
      ok: true,
      deleted: deleteExpiredAudios(folder, retentionDays)
    });
  }

  if (action === "audio_read") {
    if (!AUDIO_FILE_PATTERN.test(String(data.filename || ""))) {
      return jsonResponse({ ok: false, error: "Nombre de audio no válido." });
    }

    try {
      return jsonResponse({
        ok: true,
        content: readAudioFile(folder, data.filename)
      });
    } catch (error) {
      return jsonResponse({ ok: false, error: "Audio no encontrado." });
    }
  }

  if (action === "audio_delete_conversations") {
    const conversationIds = Array.isArray(data.conversation_ids)
      ? data.conversation_ids
      : [];

    if (
      conversationIds.length < 1 ||
      conversationIds.length > 100 ||
      conversationIds.some(function(id) {
        return !CONVERSATION_ID_PATTERN.test(String(id || ""));
      })
    ) {
      return jsonResponse({ ok: false, error: "Conversaciones no válidas." });
    }

    return jsonResponse({
      ok: true,
      deleted: deleteAudiosByConversation(folder, conversationIds)
    });
  }

  if (action !== "audio_upload") {
    return jsonResponse({ ok: false, error: "Acción de audio no válida." });
  }

  if (!AUDIO_FILE_PATTERN.test(String(data.filename || ""))) {
    return jsonResponse({ ok: false, error: "Nombre de audio no válido." });
  }

  if (
    typeof data.content !== "string" ||
    data.content.length === 0 ||
    data.content.length > MAX_AUDIO_CONTENT_LENGTH
  ) {
    return jsonResponse({ ok: false, error: "Contenido de audio no válido." });
  }

  const retentionDays = Math.min(
    30,
    Math.max(1, Number(data.retention_days) || 30)
  );

  deleteExistingFile(folder, data.filename);
  const file = folder.createFile(
    data.filename,
    data.content,
    MimeType.PLAIN_TEXT
  );
  deleteExpiredAudios(folder, retentionDays);

  return jsonResponse({ ok: true, file_id: file.getId() });
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

    const action = String(data.action || "upload");

    if (action.indexOf("audio_") === 0) {
      return handleAudioAction(data, action);
    }

    if (action === "upload") {
      deleteExpiredAudios(getOrCreateAudioFolder(), 30);
    }

    const folder = getOrCreateBackupFolder();

    if (action === "list") {
      return jsonResponse({ ok: true, files: listBackupFiles(folder) });
    }

    if (action === "read") {
      if (!BACKUP_FILE_PATTERN.test(String(data.filename || ""))) {
        return jsonResponse({ ok: false, error: "Nombre de archivo no válido." });
      }

      return jsonResponse({
        ok: true,
        content: readBackupFile(folder, data.filename)
      });
    }

    if (action !== "upload") {
      return jsonResponse({ ok: false, error: "Acción no válida." });
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
    return jsonResponse({ ok: false, error: "No se pudo procesar la solicitud." });
  }
}

