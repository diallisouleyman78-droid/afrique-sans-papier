import { randomBytes, pbkdf2Sync, createHash, timingSafeEqual, generateKeyPairSync, sign, verify } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const hashPassword = (pwd) => {
  const salt = randomBytes(16).toString('hex')
  const dk = pbkdf2Sync(pwd, salt, 200_000, 32, 'sha256').toString('hex')
  return `pbkdf2_sha256$200000$${salt}$${dk}`
}

export const verifyPassword = (pwd, stored) => {
  try {
    const [, , salt, dk] = stored.split('$')
    const computed = pbkdf2Sync(pwd, salt, 200_000, 32, 'sha256')
    return timingSafeEqual(Buffer.from(dk, 'hex'), computed)
  } catch {
    return false
  }
}

export const newToken = () => randomBytes(32).toString('base64url')
export const hashToken = (t) => createHash('sha256').update(t).digest('hex')
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

export const newVerificationCode = () => {
  let raw = ''
  for (let i = 0; i < 12; i++) raw += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return `AFR-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`
}

const KEYS_DIR = process.env.KEYS_DIR || join(process.cwd(), 'keys')
mkdirSync(KEYS_DIR, { recursive: true })
const PRIV = join(KEYS_DIR, 'ed25519.pem')
const PUB = join(KEYS_DIR, 'ed25519.pub')

function loadOrCreateKey() {
  if (existsSync(PRIV)) {
    const data = readFileSync(PRIV, 'utf8')
    return { privateKey: data, publicKey: readFileSync(PUB, 'utf8') }
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  writeFileSync(PRIV, privateKey, { mode: 0o600 })
  writeFileSync(PUB, publicKey)
  return { privateKey, publicKey }
}

const { privateKey, publicKey } = loadOrCreateKey()

export const signDigest = (digestHex) => sign(null, Buffer.from(digestHex, 'hex'), privateKey).toString('base64')
export const verifyDigest = (digestHex, signatureB64) => {
  try {
    return verify(null, Buffer.from(digestHex, 'hex'), publicKey, Buffer.from(signatureB64, 'base64'))
  } catch {
    return false
  }
}
export const publicKeyPem = () => publicKey
