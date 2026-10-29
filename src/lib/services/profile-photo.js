import { bad, notFound } from '../util';
import { json } from '../db';
import { saveUpload, readFile } from './files';

export function profilePhotoUrl(db, user) {
  const id = json(db.get("SELECT data FROM user_json WHERE user_id=? AND kind='profile_photo'", user.id)?.data, {})?.fileId;
  return Number.isSafeInteger(id) && id > 0 ? `/api/profile/photo?v=${id}` : null;
}
export async function uploadProfilePhoto(db, user, file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw bad('Choose a profile photo');
  if (!file.size || file.size > 2 * 1024 * 1024) throw bad('Choose an image smaller than 2 MB');
  const buffer = Buffer.from(await file.arrayBuffer());
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer.length > 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  const extension = file.name.toLowerCase().split('.').pop();
  if (!((png && extension === 'png') || (jpeg && ['jpg', 'jpeg'].includes(extension)))) throw bad('Choose a valid JPG or PNG image');
  const saved = await saveUpload(db, user, 'profile_photo', user.id, file, ['jpg', 'jpeg', 'png']);
  db.run("INSERT INTO user_json(user_id,kind,data) VALUES(?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET data=excluded.data", user.id, 'profile_photo', JSON.stringify({ fileId: saved.id }));
  return { url: profilePhotoUrl(db, user) };
}
export function getProfilePhoto(db, user) {
  const url = profilePhotoUrl(db, user);
  if (!url) throw notFound('No profile photo');
  const id = Number(new URL(url, 'http://localhost').searchParams.get('v'));
  return readFile(db, user, id, (file) => file.entity_type === 'profile_photo' && file.entity_id === user.id && file.uploaded_by === user.id);
}
export function removeProfilePhoto(db, user) {
  db.run("DELETE FROM user_json WHERE user_id=? AND kind='profile_photo'", user.id);
  return { url: null };
}
