import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import * as catalog from './catalog.js'
import { hashPassword } from './security.js'

const DB_PATH = process.env.DATABASE_PATH || join(process.cwd(), 'asp.db')
const STORAGE_DIR = process.env.STORAGE_DIR || join(process.cwd(), 'storage')

mkdirSync(STORAGE_DIR, { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'citoyen',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS registre (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_id TEXT NOT NULL,
    numero TEXT NOT NULL,
    nom TEXT NOT NULL,
    date_naissance TEXT NOT NULL,
    lieu TEXT NOT NULL,
    annule INTEGER DEFAULT 0,
    motif_annulation TEXT,
    UNIQUE(type_id, numero)
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reference TEXT UNIQUE NOT NULL,
    center TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    rappel INTEGER DEFAULT 1,
    status TEXT DEFAULT 'confirme',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type_id TEXT NOT NULL,
    numero_acte TEXT NOT NULL,
    nom_declare TEXT NOT NULL,
    date_naissance_declaree TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_sha256 TEXT NOT NULL,
    reference TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL,
    motif TEXT,
    authority TEXT NOT NULL,
    city TEXT NOT NULL,
    service TEXT NOT NULL,
    registry_id INTEGER,
    certified_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    reference TEXT UNIQUE NOT NULL,
    timbre_id TEXT NOT NULL,
    method TEXT NOT NULL,
    amount INTEGER NOT NULL,
    taxe INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS emissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER UNIQUE NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    verification_code TEXT UNIQUE NOT NULL,
    timbre_id TEXT,
    pdf_path TEXT NOT NULL,
    pdf_sha256 TEXT NOT NULL,
    signature TEXT NOT NULL,
    issued_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`)

export function seedIfEmpty() {
  const has = db.prepare('SELECT id FROM registre LIMIT 1').get()
  if (has) return

  const insertReg = db.prepare('INSERT INTO registre (type_id, numero, nom, date_naissance, lieu, annule, motif_annulation) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const insertUser = db.prepare('INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)')
  const seed = db.transaction(() => {
    for (const e of catalog.REGISTRE_DEMO) {
      insertReg.run(e.type_id, e.numero, e.nom, e.date_naissance, e.lieu, e.annule ? 1 : 0, e.motif_annulation || null)
    }
    insertUser.run(catalog.DEMO_USER.name, catalog.DEMO_USER.email, catalog.DEMO_USER.phone, hashPassword(catalog.DEMO_USER.password))
  })
  seed()
}

seedIfEmpty()

export { db, STORAGE_DIR }
