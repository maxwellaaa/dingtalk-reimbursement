import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { query } from '../db/pool.js';

export function ensureUploadDir() {
  const dir = path.resolve(process.cwd(), config.upload.dir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function hashFile(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function saveAttachment(file, userId) {
  const sha256 = hashFile(file.buffer);
  const ext = path.extname(file.originalname || '') || '';
  const storedName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  const uploadDir = ensureUploadDir();
  const fullPath = path.join(uploadDir, storedName);
  fs.writeFileSync(fullPath, file.buffer);

  const relativePath = path.join(config.upload.dir, storedName).replace(/\\/g, '/');
  const result = await query(
    `INSERT INTO file_attachment (biz_type, biz_id, file_name, file_path, file_size, mime_type, sha256, uploaded_by)
     VALUES ('pending', 0, :fileName, :filePath, :fileSize, :mimeType, :sha256, :userId)`,
    {
      fileName: file.originalname,
      filePath: relativePath,
      fileSize: file.size,
      mimeType: file.mimetype,
      sha256,
      userId,
    },
  );

  return {
    id: result.insertId,
    fileName: file.originalname,
    fileSize: file.size,
    mimeType: file.mimetype,
  };
}

export async function getAttachmentForUser(id, userId) {
  const rows = await query(
    `SELECT id, file_name AS fileName, file_path AS filePath, mime_type AS mimeType, uploaded_by AS uploadedBy
     FROM file_attachment WHERE id = :id LIMIT 1`,
    { id },
  );
  const row = rows[0];
  if (!row) return null;
  if (row.uploadedBy !== userId) return null;
  return row;
}

export function resolveAttachmentPath(relativePath) {
  return path.resolve(process.cwd(), relativePath);
}
