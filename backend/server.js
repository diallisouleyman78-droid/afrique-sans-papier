import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import * as catalog from './lib/catalog.js'
import { db, STORAGE_DIR } from './lib/db.js'
import { newToken, hashToken, sha256, newVerificationCode, verifyPassword, hashPassword, publicKeyPem, verifyDigest } from './lib/security.js'
import { validateAgainstRegistry, normalizeNumero } from './lib/validation.js'
import { generatePdf, extractCode, maskName, markerFor, dateFr, heureFr } from './lib/pdf.js'

const app = express()
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }))
app.use(express.json())

const upload = multer({ dest: join(STORAGE_DIR, 'tmp'), limits: { fileSize: 10 * 1024 * 1024 } })

// ---------------------------------------------------------------- helpers

function uniqueRef(table, prefix) {
  const year = new Date().getFullYear()
  while (true) {
    const ref = `${prefix}-${year}-${Math.floor(100000 + Math.random() * 900000)}`
    const exists = db.prepare(`SELECT 1 FROM ${table} WHERE reference = ?`).get(ref)
    if (!exists) return ref
  }
}

function audit(actorId, action, target, details) {
  db.prepare('INSERT INTO audit_logs (actor_id, action, target, details) VALUES (?, ?, ?, ?)')
    .run(actorId ?? null, action, target, details ? JSON.stringify(details) : null)
}

function currentUser(req, res, next) {
  const header = req.headers.authorization
  if (!header?.toLowerCase().startsWith('bearer ')) return res.status(401).json({ error: 'Connexion requise.' })
  const token = header.slice(7).trim()
  const session = db.prepare('SELECT s.user_id, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(hashToken(token))
  if (!session) return res.status(401).json({ error: 'Session expiree.' })
  req.user = session
  next()
}

function serializeUser(u) {
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role }
}

function paidPayment(docId) {
  return db.prepare("SELECT * FROM payments WHERE document_id = ? AND status = 'paye' ORDER BY id DESC LIMIT 1").get(docId)
}

function serializeDocument(doc) {
  const emission = db.prepare('SELECT * FROM emissions WHERE document_id = ?').get(doc.id)
  const payment = paidPayment(doc.id)
  const timbreId = emission?.timbre_id || payment?.timbre_id
  const timbre = timbreId ? catalog.TIMBRES[timbreId] : null
  const entry = doc.registry_id ? db.prepare('SELECT * FROM registre WHERE id = ?').get(doc.registry_id) : null

  const versions = [{ label: 'Demande creee', date: dateFr(new Date(doc.created_at)), status: 'Conserve' }]
  if (doc.status === 'valide') versions.push({ label: 'Valide automatiquement (registre)', date: dateFr(new Date(doc.certified_at)), status: 'Conserve' })
  else if (doc.status === 'rejete') versions.push({ label: 'Rejete automatiquement', date: dateFr(new Date(doc.created_at)), status: 'Rejete' })
  for (const p of db.prepare('SELECT * FROM payments WHERE document_id = ?').all(doc.id)) {
    versions.push({
      label: p.status === 'paye' ? 'Paiement confirme' : 'Paiement refuse',
      date: dateFr(new Date(p.created_at)),
      status: p.status === 'paye' ? 'Conserve' : 'Echec',
    })
  }
  if (emission) versions.push({ label: 'Document signe et emis', date: dateFr(new Date(emission.issued_at)), status: 'Conserve' })

  const baseUrl = (process.env.VERIFY_BASE_URL || 'http://localhost:5173/verifier').replace(/\/$/, '')
  return {
    id: doc.id,
    typeId: doc.type_id,
    type: catalog.DOCUMENT_TYPES[doc.type_id],
    numeroActe: doc.numero_acte,
    fileName: doc.file_name,
    empreinteScan: doc.file_sha256,
    reference: doc.reference,
    status: doc.status,
    motif: doc.motif,
    authority: doc.authority,
    city: doc.city,
    service: doc.service,
    needsTimbre: catalog.SERVICES_AVEC_TIMBRE.has(doc.service),
    certified: doc.status === 'valide',
    certifiedAt: doc.certified_at ? dateFr(new Date(doc.certified_at)) : null,
    createdAt: dateFr(new Date(doc.created_at)),
    timbre: timbre ? { id: timbreId, label: timbre.label, price: timbre.price } : null,
    payment: payment ? {
      method: payment.method,
      methodLabel: catalog.PAYMENT_METHODS[payment.method],
      amount: payment.amount,
      taxe: payment.taxe,
      paidAt: dateFr(new Date(payment.created_at)),
      status: 'Paye',
    } : null,
    issued: !!emission,
    qrData: emission?.verification_code || null,
    verifyUrl: emission ? `${baseUrl}/${emission.verification_code}` : null,
    empreinte: emission?.pdf_sha256 || null,
    signature: emission?.signature || null,
    issuedAt: emission ? dateFr(new Date(emission.issued_at)) : null,
    versions,
  }
}

function serializeAppointment(a) {
  const d = new Date(a.date)
  const dayIdx = d.getUTCDay() - 1
  return {
    id: a.id,
    reference: a.reference,
    center: a.center,
    docType: a.doc_type,
    dateIso: a.date,
    date: `${catalog.JOURS[dayIdx < 0 ? 6 : dayIdx]}. ${d.getUTCDate()} ${catalog.MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    time: a.time,
    rappel: !!a.rappel,
    status: a.status === 'confirme' ? 'Confirme' : a.status,
  }
}

function verdict(em, fileKind = null) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(em.document_id)
  const entry = doc.registry_id ? db.prepare('SELECT * FROM registre WHERE id = ?').get(doc.registry_id) : null
  const ok = existsSync(em.pdf_path) && sha256(readFileSync(em.pdf_path)) === em.pdf_sha256 && verifyDigest(em.pdf_sha256, em.signature)
  const timbre = em.timbre_id ? catalog.TIMBRES[em.timbre_id] : null
  let statut = 'valide'
  let motif = null
  if (fileKind === 'modifie' || !ok) {
    statut = 'signature_invalide'
  } else if (entry?.annule) {
    statut = 'revoque'
    motif = entry.motif_annulation
  }
  return {
    statut,
    motif,
    fichier: fileKind,
    code: em.verification_code,
    type: catalog.DOCUMENT_TYPES[doc.type_id],
    reference: doc.reference,
    ville: doc.city,
    autorite: catalog.AUTORITES[doc.authority].label,
    timbre: timbre?.label || null,
    emisLe: dateFr(new Date(em.issued_at)),
    titulaire: maskName(entry?.nom || doc.nom_declare),
    empreinte: em.pdf_sha256,
  }
}

// ---------------------------------------------------------------- auth

function openSession(userId) {
  const token = newToken()
  db.prepare('INSERT INTO sessions (token_hash, user_id) VALUES (?, ?)').run(hashToken(token), userId)
  return token
}

app.post('/api/auth/register', (req, res) => {
  const { name = '', email = '', phone = '', password = '' } = req.body
  const n = name.trim()
  const e = email.trim().toLowerCase() || null
  const p = phone.trim() || null
  if (!n) return res.status(422).json({ error: 'Le nom est requis.' })
  if (!e && !p) return res.status(422).json({ error: 'Renseigne au moins un e-mail ou un telephone.' })
  if (password.length < 6) return res.status(422).json({ error: 'Le mot de passe doit contenir au moins 6 caracteres.' })

  const conds = []
  const vals = []
  if (e) { conds.push('email = ?'); vals.push(e) }
  if (p) { conds.push('phone = ?'); vals.push(p) }
  if (db.prepare(`SELECT id FROM users WHERE ${conds.join(' OR ')}`).get(...vals)) {
    return res.status(409).json({ error: 'Un compte existe deja avec ces informations.' })
  }
  const result = db.prepare('INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)').run(n, e, p, hashPassword(password))
  audit(result.lastInsertRowid, 'compte.cree', `user:${result.lastInsertRowid}`)
  res.status(201).json({ token: openSession(result.lastInsertRowid), user: serializeUser({ id: result.lastInsertRowid, name: n, email: e, phone: p, role: 'citoyen' }) })
})

app.post('/api/auth/login', (req, res) => {
  const id = (req.body.identifier || '').trim()
  const user = db.prepare('SELECT * FROM users WHERE email = ? OR phone = ?').get(id.toLowerCase(), id)
  if (!user || !verifyPassword(req.body.password || '', user.password_hash)) return res.status(401).json({ error: 'Identifiants incorrects.' })
  audit(user.id, 'compte.connexion', `user:${user.id}`)
  res.json({ token: openSession(user.id), user: serializeUser(user) })
})

app.get('/api/auth/me', currentUser, (req, res) => res.json(serializeUser(req.user)))

app.post('/api/auth/logout', (req, res) => {
  const h = req.headers.authorization
  if (h?.toLowerCase().startsWith('bearer ')) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(h.slice(7).trim()))
  res.sendStatus(204)
})

// ---------------------------------------------------------------- rendez-vous

function placesPrises(center, date, time) {
  return db.prepare("SELECT COUNT(*) c FROM appointments WHERE center = ? AND date = ? AND time = ? AND status = 'confirme'").get(center, date, time).c
}

app.get('/api/creneaux', (req, res) => {
  const { center, date } = req.query
  res.json(catalog.SLOTS.map((time) => {
    const restant = Math.max(catalog.SLOT_CAPACITY - placesPrises(center, date, time), 0)
    return { time, restant, complet: restant === 0 }
  }))
})

app.get('/api/rendez-vous', currentUser, (req, res) => {
  res.json(db.prepare('SELECT * FROM appointments WHERE user_id = ? ORDER BY date, time').all(req.user.id).map(serializeAppointment))
})

app.post('/api/rendez-vous', currentUser, (req, res) => {
  const { center, docType, date, time, rappel = true } = req.body
  if (!catalog.CENTERS.includes(center)) return res.status(422).json({ error: 'Centre inconnu.' })
  if (!catalog.RDV_DOC_TYPES.includes(docType)) return res.status(422).json({ error: 'Type inconnu.' })
  if (!catalog.SLOTS.includes(time)) return res.status(422).json({ error: 'Creneau inconnu.' })
  const d = new Date(date)
  if (isNaN(d) || d <= new Date(new Date().toDateString())) return res.status(422).json({ error: 'Date invalide.' })
  if (placesPrises(center, date, time) >= catalog.SLOT_CAPACITY) return res.status(409).json({ error: 'Creneau complet.' })

  const ref = uniqueRef('appointments', 'RDV')
  const result = db.prepare('INSERT INTO appointments (user_id, reference, center, doc_type, date, time, rappel) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.user.id, ref, center, docType, date, time, rappel ? 1 : 0)
  audit(req.user.id, 'rdv.reserve', `rdv:${ref}`, { sms: 'Confirmation simulee envoyee' })
  res.status(201).json(serializeAppointment({ id: result.lastInsertRowid, user_id: req.user.id, reference: ref, center, doc_type: docType, date, time, rappel: rappel ? 1 : 0, status: 'confirme' }))
})

// ---------------------------------------------------------------- documents

function getUserDoc(dbConn, docId, user) {
  const doc = dbConn.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(docId, user.id)
  if (!doc) throw new Error('Document introuvable.')
  return doc
}

app.get('/api/documents', currentUser, (req, res) => {
  res.json(db.prepare('SELECT * FROM documents WHERE user_id = ? ORDER BY id DESC').all(req.user.id).map(serializeDocument))
})

app.get('/api/documents/:id', currentUser, (req, res) => {
  try {
    res.json(serializeDocument(getUserDoc(db, req.params.id, req.user)))
  } catch (e) { res.status(404).json({ error: e.message }) }
})

app.post('/api/documents', currentUser, upload.single('file'), (req, res) => {
  const { typeId, numeroActe, nom, dateNaissance, authority, city, service } = req.body
  const file = req.file

  if (!catalog.DOCUMENT_TYPES[typeId]) return res.status(422).json({ error: 'Type de document inconnu.' })
  if (!catalog.AUTORITES[authority]) return res.status(422).json({ error: 'Autorite inconnue.' })
  if (!catalog.VILLES.includes(city)) return res.status(422).json({ error: 'Ville inconnue.' })
  if (!catalog.SERVICES.has(service)) return res.status(422).json({ error: 'Service inconnu.' })
  if (!numeroActe?.trim() || !nom?.trim() || !dateNaissance?.trim()) return res.status(422).json({ error: 'Numero, nom et date obligatoires.' })
  if (!file) return res.status(422).json({ error: 'Fichier requis.' })

  const ext = file.originalname.split('.').pop().toLowerCase()
  if (!['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) return res.status(422).json({ error: 'Format accepte : PDF, JPG ou PNG.' })

  const data = readFileSync(file.path)
  const scans = join(STORAGE_DIR, 'scans')
  mkdirSync(scans, { recursive: true })
  const dest = join(scans, `${randomBytes(16).toString('hex')}.${ext}`)
  writeFileSync(dest, data)

  const { status, motif, entry } = validateAgainstRegistry(db, typeId, numeroActe, nom, dateNaissance)
  const ref = uniqueRef('documents', 'REQ')
  const result = db.prepare('INSERT INTO documents (user_id, type_id, numero_acte, nom_declare, date_naissance_declaree, file_name, file_path, file_sha256, reference, status, motif, authority, city, service, registry_id, certified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.user.id, typeId, normalizeNumero(numeroActe), nom.trim(), dateNaissance.trim(), file.originalname, dest, sha256(data), ref, status, motif, authority, city, service, entry?.id || null, status === 'valide' ? new Date().toISOString() : null)
  const docId = result.lastInsertRowid
  audit(req.user.id, 'document.cree', `document:${ref}`, { empreinte_scan: sha256(data) })
  audit(null, `document.${status}_auto`, `document:${ref}`, { motif })
  res.status(201).json(serializeDocument({ ...db.prepare('SELECT * FROM documents WHERE id = ?').get(docId), registry_id: entry?.id || null, certified_at: status === 'valide' ? new Date().toISOString() : null }))
})

app.post('/api/documents/:id/emission', currentUser, async (req, res) => {
  try {
    const doc = getUserDoc(db, req.params.id, req.user)
    const existing = db.prepare('SELECT * FROM emissions WHERE document_id = ?').get(doc.id)
    if (existing) return res.json(serializeDocument(doc))
    if (doc.status !== 'valide') return res.status(409).json({ error: 'Seul un document valide peut etre emis.' })

    let timbreId = null
    let montant = null
    if (catalog.SERVICES_AVEC_TIMBRE.has(doc.service)) {
      let payment = paidPayment(doc.id)
      if (!payment) {
        const { timbreId: t = 'fiscal', method = 'orange', simulerEchec = false } = req.body
        if (!catalog.TIMBRES[t]) return res.status(422).json({ error: 'Timbre invalide.' })
        if (!catalog.PAYMENT_METHODS[method]) return res.status(422).json({ error: 'Moyen de paiement invalide.' })
        const price = catalog.TIMBRES[t].price
        const payRef = uniqueRef('payments', 'PAY')
        const payStatus = simulerEchec ? 'echoue' : 'paye'
        db.prepare('INSERT INTO payments (document_id, reference, timbre_id, method, amount, taxe, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(doc.id, payRef, t, method, price + catalog.TAXE, catalog.TAXE, payStatus)
        audit(req.user.id, `paiement.${payStatus}`, `document:${doc.reference}`, { montant: price + catalog.TAXE })
        if (simulerEchec) return res.status(402).json({ error: 'Paiement refuse (simulation). Aucun document emis.' })
        payment = paidPayment(doc.id)
      }
      timbreId = payment.timbre_id
      montant = payment.amount
    }

    const entry = doc.registry_id ? db.prepare('SELECT * FROM registre WHERE id = ?').get(doc.registry_id) : null
    const code = newVerificationCode()
    while (db.prepare('SELECT 1 FROM emissions WHERE verification_code = ?').get(code)) {
      // eviter doublon extreme
    }
    const baseUrl = (process.env.VERIFY_BASE_URL || 'http://localhost:5173/verifier').replace(/\/$/, '')
    const { digest, signature } = await generatePdf({
      code,
      verifyUrl: `${baseUrl}/${code}`,
      typeId: doc.type_id,
      reference: doc.reference,
      titulaire: entry?.nom || doc.nom_declare,
      numeroActe: doc.numero_acte,
      dateNaissance: entry?.date_naissance || doc.date_naissance_declaree,
      autorite: doc.authority,
      city: doc.city,
      timbre: timbreId ? catalog.TIMBRES[timbreId] : null,
      montant,
      emisLe: `${dateFr()} a ${heureFr()} UTC`,
      storageDir: STORAGE_DIR,
    })

    db.prepare('INSERT INTO emissions (document_id, verification_code, timbre_id, pdf_path, pdf_sha256, signature) VALUES (?, ?, ?, ?, ?, ?)')
      .run(doc.id, code, timbreId, join(STORAGE_DIR, 'emis', `${code}.pdf`), digest, signature)
    audit(req.user.id, 'document.emis', `document:${doc.reference}`, { code, empreinte: digest })
    res.json(serializeDocument(doc))
  } catch (e) { res.status(400).json({ error: e.message }) }
})

app.get('/api/documents/:id/pdf', currentUser, (req, res) => {
  try {
    const doc = getUserDoc(db, req.params.id, req.user)
    const em = db.prepare('SELECT * FROM emissions WHERE document_id = ?').get(doc.id)
    if (!em) return res.status(409).json({ error: 'Pas encore emis.' })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${doc.reference}.pdf"`)
    res.send(readFileSync(em.pdf_path))
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// ---------------------------------------------------------------- verification publique

app.get('/api/verification/:code', (req, res) => {
  const em = db.prepare('SELECT * FROM emissions WHERE verification_code = ?').get(req.params.code.trim().toUpperCase())
  if (!em) return res.json({ statut: 'inconnu' })
  res.json(verdict(em))
})

app.post('/api/verification/fichier', upload.single('file'), (req, res) => {
  const file = req.file
  if (!file) return res.status(422).json({ error: 'Fichier requis.' })
  const data = readFileSync(file.path)
  const byHash = db.prepare('SELECT * FROM emissions WHERE pdf_sha256 = ?').get(sha256(data))
  if (byHash) return res.json(verdict(byHash, 'identique'))
  const code = extractCode(data)
  const byCode = code ? db.prepare('SELECT * FROM emissions WHERE verification_code = ?').get(code) : null
  if (byCode) return res.json(verdict(byCode, 'modifie'))
  res.json({ statut: 'inconnu', fichier: 'inconnu' })
})

app.get('/api/cle-publique', (_req, res) => res.json({ algorithme: 'Ed25519', empreinte: 'SHA-256 du PDF', clePublique: publicKeyPem() }))

// ---------------------------------------------------------------- demo

app.get('/api/demo/registre', (_req, res) => {
  res.json(db.prepare('SELECT * FROM registre ORDER BY id').all().map(e => ({
    id: e.id,
    typeId: e.type_id,
    type: catalog.DOCUMENT_TYPES[e.type_id],
    numero: e.numero,
    nom: e.nom,
    dateNaissance: e.date_naissance,
    lieu: e.lieu,
    annule: !!e.annule,
    motifAnnulation: e.motif_annulation,
  })))
})

app.post('/api/demo/registre/:id/annuler', (req, res) => {
  const e = db.prepare('SELECT * FROM registre WHERE id = ?').get(req.params.id)
  if (!e) return res.status(404).json({ error: 'Introuvable.' })
  db.prepare('UPDATE registre SET annule = 1, motif_annulation = ? WHERE id = ?').run(req.body.motif || 'Acte annule (demo)', req.params.id)
  res.json({ id: e.id, annule: true })
})

app.post('/api/demo/registre/:id/retablir', (req, res) => {
  const e = db.prepare('SELECT * FROM registre WHERE id = ?').get(req.params.id)
  if (!e) return res.status(404).json({ error: 'Introuvable.' })
  db.prepare('UPDATE registre SET annule = 0, motif_annulation = NULL WHERE id = ?').run(req.params.id)
  res.json({ id: e.id, annule: false })
})

app.get('/api/sante', (_req, res) => res.json({ ok: true }))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`API ASP ecoute sur http://localhost:${PORT}`))
