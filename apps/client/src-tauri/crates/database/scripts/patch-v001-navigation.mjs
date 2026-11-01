import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const p = path.join(__dirname, '../src/migrations/migrations_v001.rs')
let s = fs.readFileSync(p, 'utf8')

const startNeedle =
  "db.execute_unprepared(r##\"INSERT OR IGNORE INTO magneticTile (id,[index],title,url,round,mark,component,description,background,backdrop,mirrorID,textColor,collectionID,size,shape,direction,downloadCount,archivedAt,createdAt,updatedAt) VALUES ('6f7714eb-bfa1-4b15-b56f-d095ff9100a3'"
const endNeedle = "VALUES ('3175fa5c-195f-4311-9d18-ecbc7c29f6d5',136,'Netlify'"

const start = s.indexOf(startNeedle)
const endLineStart = s.indexOf(endNeedle)
if (start < 0 || endLineStart < 0) {
  console.error('markers not found', start, endLineStart)
  process.exit(1)
}
const end = s.indexOf('\n', endLineStart)
const replacement =
  '        // ── navigation 种子（表驱动，见 navigation_seed.rs）──\n' +
  '        for statement in super::navigation_seed::insert_statements() {\n' +
  '            db.execute_unprepared(&statement).await?;\n' +
  '        }\n'

fs.writeFileSync(p, s.slice(0, start) + replacement + s.slice(end + 1))
console.log('patched navigation inserts in migrations_v001.rs')
