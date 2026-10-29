import fs from 'node:fs';
import path from 'node:path';
import { bad, forbidden, notFound, nowIso, insert, audit } from '../util';
import { sha256 } from '../crypto';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const uploadDir = () => path.join(process.env.UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads'));
export const extOf = (name) => String(name).toLowerCase().split('.').pop();

export function validateUpload(name, size, only) {
  const ext = extOf(name);
  if (!ALLOWED[ext] || (only && !only.includes(ext))) throw bad(`Unsupported file type ".${ext}". Allowed: ${(only || Object.keys(ALLOWED)).join(', ').toUpperCase()}`);
  if (size > MAX_FILE_BYTES) throw bad('File is larger than the 10 MB limit');
  if (size === 0) throw bad('File is empty');
  return ALLOWED[ext];
}

export async function saveUpload(db, user, entityType, entityId, file, only) {
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = validateUpload(file.name, buf.length, only);
  const hash = sha256(buf);
  fs.mkdirSync(uploadDir(), { recursive: true });
  const id = insert(db, 'files', { entity_type: entityType, entity_id: entityId, name: path.basename(file.name).slice(0, 120), mime, size: buf.length, path: '', sha256: hash, uploaded_by: user.id, created_at: nowIso() });
  const rel = `${id}-${hash.slice(0, 12)}.${extOf(file.name)}`;
  fs.writeFileSync(path.join(uploadDir(), rel), buf);
  db.run('UPDATE files SET path=? WHERE id=?', rel, id);
  audit(db, user, 'file.upload', entityType, entityId, file.name);
  return { ...db.get('SELECT id,name,mime,size,sha256,created_at FROM files WHERE id=?', id), buffer: buf };
}

export function readFile(db, user, id, canAccess) {
  const f = db.get('SELECT * FROM files WHERE id=?', id);
  if (!f) throw notFound('File not found');
  if (!canAccess(f)) throw forbidden();
  const full = path.join(uploadDir(), path.basename(f.path));
  if (!fs.existsSync(full)) throw notFound('File content is missing');
  return { file: f, data: fs.readFileSync(full) };
}
