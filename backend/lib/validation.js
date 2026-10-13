export const normalizeText = (s = '') =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

export const normalizeNumero = (s = '') => s.replace(/\s/g, '').toUpperCase()

const sameNames = (a, b) =>
  normalizeText(a).split(' ').sort().join(' ') === normalizeText(b).split(' ').sort().join(' ')

export const validateAgainstRegistry = (db, typeId, numero, nom, dateNaissance) => {
  const entry = db.prepare('SELECT * FROM registre WHERE type_id = ? AND numero = ?').get(typeId, normalizeNumero(numero))
  if (!entry) return { status: 'rejete', motif: 'Numero introuvable dans le registre officiel.', entry: null }
  if (entry.annule) return { status: 'rejete', motif: `Acte annule dans le registre : ${entry.motif_annulation || 'sans motif'}.`, entry }
  if (!sameNames(nom, entry.nom)) return { status: 'rejete', motif: 'Le nom ne correspond pas au registre officiel.', entry }
  if (dateNaissance.trim() !== entry.date_naissance) return { status: 'rejete', motif: 'La date de naissance ne correspond pas au registre officiel.', entry }
  return { status: 'valide', motif: null, entry }
}
