import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
const client = new SecretsManagerClient({})
const result = await client.send(new GetSecretValueCommand({ SecretId: process.env.ALONGSIDE_SECRET_ARN }))
const values = JSON.parse(result.SecretString!)
for (const [key, value] of Object.entries(values)) { process.env[key] = String(value) }
await import('./gateway')
