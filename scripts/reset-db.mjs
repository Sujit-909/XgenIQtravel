// Deletes the local SQLite database so it is re-created and re-seeded with demo data on the next start.
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'geniq.db');
for (const f of [file, `${file}-wal`, `${file}-shm`]) { if (fs.existsSync(f)) { fs.rmSync(f); console.log('removed', f); } }
console.log('Done. The database is re-seeded automatically the next time the app starts.');
