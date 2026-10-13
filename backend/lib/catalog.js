export const DOCUMENT_TYPES = {
  acte_naissance: 'Acte de naissance',
  diplome: 'Diplome du baccalaureat',
  certificat_residence: 'Certificat de residence',
  carte_nationale: 'Carte nationale',
  passeport: 'Passeport',
}

export const AUTORITES = {
  sous_prefet: { label: 'Sous-prefet', prefix: 'SOUS-PREFECTURE' },
  maire: { label: 'Maire', prefix: 'MAIRIE' },
  ministre: { label: 'Ministre', prefix: 'MINISTERE' },
}

export const VILLES = ['Yaounde', 'Douala', 'Bafoussam', 'Garoua', 'Bamenda', 'Maroua']

export const SERVICES = new Set(['certification', 'timbrage', 'certification_timbrage'])
export const SERVICES_AVEC_TIMBRE = new Set(['timbrage', 'certification_timbrage'])

export const TIMBRES = {
  fiscal: { label: 'Timbre fiscal', price: 1500 },
  communal: { label: 'Timbre communal', price: 500 },
  postal: { label: 'Timbre postal', price: 1000 },
}

export const PAYMENT_METHODS = {
  orange: 'Orange Money',
  mtn: 'MTN Mobile Money',
  card: 'Carte bancaire',
}

export const TAXE = 20

export const CENTERS = ['Centre de numerisation (demo)', 'Centre Yaounde', 'Centre Douala']
export const RDV_DOC_TYPES = ['Acte de naissance', 'Diplome', 'Carte nationale', 'Passeport']
export const SLOTS = ['08:00', '09:30', '11:00', '12:30', '14:00', '15:30']
export const SLOT_CAPACITY = 2

export const REGISTRE_DEMO = [
  { type_id: 'acte_naissance', numero: 'AN-2001-004512', nom: 'Awa Diallo', date_naissance: '2001-03-14', lieu: 'Yaounde' },
  { type_id: 'acte_naissance', numero: 'AN-1999-001234', nom: 'Jean Mbarga', date_naissance: '1999-07-22', lieu: 'Douala' },
  { type_id: 'acte_naissance', numero: 'AN-2003-007788', nom: 'Fatou Ngono', date_naissance: '2003-11-02', lieu: 'Bafoussam' },
  { type_id: 'acte_naissance', numero: 'AN-1998-000999', nom: 'Paul Etoundi', date_naissance: '1998-01-30', lieu: 'Garoua', annule: true, motif_annulation: 'Acte annule par jugement (demo)' },
  { type_id: 'diplome', numero: 'BAC-2019-123456', nom: 'Awa Diallo', date_naissance: '2001-03-14', lieu: 'Yaounde' },
  { type_id: 'diplome', numero: 'BAC-2018-654321', nom: 'Jean Mbarga', date_naissance: '1999-07-22', lieu: 'Douala' },
  { type_id: 'certificat_residence', numero: 'CR-2026-000321', nom: 'Awa Diallo', date_naissance: '2001-03-14', lieu: 'Yaounde' },
  { type_id: 'carte_nationale', numero: 'CNI-112233445', nom: 'Awa Diallo', date_naissance: '2001-03-14', lieu: 'Yaounde' },
  { type_id: 'passeport', numero: 'PA-0123456', nom: 'Awa Diallo', date_naissance: '2001-03-14', lieu: 'Yaounde' },
]

export const DEMO_USER = { name: 'Awa Diallo', email: 'awa@demo.cm', phone: '690000000', password: 'demo123' }

export const MOIS = ['janv.', 'fevr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'aout', 'sept.', 'oct.', 'nov.', 'dec.']
export const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
