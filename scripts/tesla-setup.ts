/**
 * One-time Tesla Fleet API setup.
 *
 *   TESLA_CLIENT_ID=... TESLA_CLIENT_SECRET=... bun scripts/tesla-setup.ts keys
 *     → creates tesla-private-key.pem / tesla-public-key.pem (gitignored)
 *
 *   bunx wrangler secret put TESLA_PUBLIC_KEY < tesla-public-key.pem && bun run deploy
 *     → serves https://<domain>/.well-known/appspecific/com.tesla.3p.public-key.pem
 *
 *   TESLA_CLIENT_ID=... TESLA_CLIENT_SECRET=... bun scripts/tesla-setup.ts register [domain]
 *     → registers the domain as a partner account in every Fleet API region
 */
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'

const TOKEN_URL = 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token'
const REGIONS = [
  'https://fleet-api.prd.na.vn.cloud.tesla.com',
  'https://fleet-api.prd.eu.vn.cloud.tesla.com',
]

const [cmd = 'help', domain = 'tslap.store'] = process.argv.slice(2)

if (cmd === 'keys') {
  if (existsSync('tesla-private-key.pem')) {
    console.log('tesla-private-key.pem already exists — not overwriting')
    process.exit(0)
  }
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  writeFileSync('tesla-private-key.pem', privateKey.export({ type: 'sec1', format: 'pem' }), { mode: 0o600 })
  writeFileSync('tesla-public-key.pem', publicKey.export({ type: 'spki', format: 'pem' }))
  console.log('Wrote tesla-private-key.pem (keep secret) and tesla-public-key.pem')
  console.log('Next: bunx wrangler secret put TESLA_PUBLIC_KEY < tesla-public-key.pem')
} else if (cmd === 'register') {
  const clientId = process.env.TESLA_CLIENT_ID
  const clientSecret = process.env.TESLA_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('TESLA_CLIENT_ID and TESLA_CLIENT_SECRET required')

  for (const base of REGIONS) {
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'openid user_data vehicle_device_data vehicle_location',
        audience: base,
      }),
    })
    const token = (await tokenRes.json()) as { access_token?: string }
    if (!token.access_token) {
      console.error(base, 'partner token failed', token)
      continue
    }
    const res = await fetch(`${base}/api/1/partner_accounts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain }),
    })
    console.log(base, res.status, await res.text())
  }
} else {
  console.log('Usage: bun scripts/tesla-setup.ts keys | register [domain]')
}
