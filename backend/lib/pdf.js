import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { sha256, signDigest } from './security.js'
import * as catalog from './catalog.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const BLUE = '#2563eb'
const BLUE_DARK = '#1e3a8a'
const GRIS = '#64748b'

export const markerFor = (code) => `ASP-CODE:${code}`
const MARKER_RE = /ASP-CODE:([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})/

export const extractCode = (buf) => {
  const text = buf.toString('latin1')
  const m = text.match(MARKER_RE)
  return m ? m[1] : null
}

export const maskName = (nom) =>
  nom.split(' ').filter(Boolean).map(p => p[0] + '*'.repeat(p.length - 1)).join(' ')

export const dateFr = (dt = new Date()) => `${dt.getDate()} ${catalog.MOIS[dt.getMonth()]} ${dt.getFullYear()}`
export const heureFr = (dt = new Date()) => `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`

export const generatePdf = async ({
  code,
  verifyUrl,
  typeId,
  reference,
  titulaire,
  numeroActe,
  dateNaissance,
  autorite,
  city,
  timbre,
  montant,
  emisLe,
  storageDir,
}) => {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `${catalog.DOCUMENT_TYPES[typeId]} - ${reference}` } })
  const chunks = []
  doc.on('data', (c) => chunks.push(c))
  const end = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))))

  const W = 595.28
  const H = 841.89
  const mm = 28.35

  doc.rect(0, H - 32 * mm, W, 32 * mm).fill(BLUE)
  doc.fillColor('white').font('Helvetica-Bold').fontSize(18).text('Afrique sans papier', 20 * mm, H - 17 * mm)
  doc.font('Helvetica').fontSize(10).text('Document certifie - prototype de demonstration, sans valeur legale', 20 * mm, H - 24 * mm)

  let y = H - 50 * mm
  doc.fillColor(BLUE_DARK).font('Helvetica-Bold').fontSize(20).text(catalog.DOCUMENT_TYPES[typeId], 20 * mm, y)
  doc.fillColor(GRIS).font('Helvetica').fontSize(10).text(`Reference : ${reference}`, 20 * mm, y - 7 * mm)

  const lines = [
    ['Titulaire', titulaire],
    ['Numero d\'acte', numeroActe],
    ['Date de naissance', dateNaissance],
    ['Autorite', catalog.AUTORITES[autorite].label],
    ['Timbre', timbre ? `${timbre.label} (${montant} FCFA)` : 'Aucun'],
    ['Emis le', emisLe],
    ['Code de verification', code],
  ]
  y -= 22 * mm
  for (const [label, value] of lines) {
    doc.fillColor(GRIS).font('Helvetica').fontSize(10).text(label, 20 * mm, y)
    doc.fillColor('black').font('Helvetica-Bold').fontSize(11).text(value, 65 * mm, y)
    y -= 9 * mm
  }

  const cx = 55 * mm
  const cy = 75 * mm
  doc.lineWidth(2).dash(4, 3).strokeColor(BLUE).circle(cx, cy, 25 * mm).stroke().undash()
  doc.fillColor(BLUE_DARK).font('Helvetica-Bold').fontSize(8).text(catalog.AUTORITES[autorite].prefix, cx - 45, cy + 6 * mm, { width: 90, align: 'center' })
  doc.fontSize(12).text('CACHET', cx - 45, cy - 2 * mm, { width: 90, align: 'center' })
  doc.font('Helvetica-Oblique').fontSize(7).text('Signature electronique Ed25519', cx - 45, cy - 9 * mm, { width: 90, align: 'center' })

  const qrPng = await QRCode.toBuffer(verifyUrl, { width: 180, margin: 1, color: { dark: BLUE_DARK } })
  const qrSize = 45 * mm
  doc.image(qrPng, W - 20 * mm - qrSize, 52 * mm, { width: qrSize })
  doc.fillColor(GRIS).font('Helvetica').fontSize(8).text('Scanner pour verifier l\'authenticite', W - 20 * mm - qrSize, 47 * mm, { width: qrSize, align: 'center' })

  doc.font('Helvetica').fontSize(7).text('Le QR code ne prouve rien a lui seul : le statut et la signature sont controles en ligne.', 20 * mm, 20 * mm)
  doc.text(verifyUrl, 20 * mm, 15 * mm)

  doc.end()
  const pdfBytes = await end
  const digest = sha256(pdfBytes)
  const signature = signDigest(digest)

  mkdirSync(join(storageDir, 'emis'), { recursive: true })
  const path = join(storageDir, 'emis', `${code}.pdf`)
  writeFileSync(path, pdfBytes)

  return { pdfBytes, digest, signature, path }
}
