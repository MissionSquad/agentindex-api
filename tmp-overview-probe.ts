import { env } from './src/env'
import { MongoPoolManager } from './src/utils/mongoPoolManager'
import { getAnalyticsOverview } from './src/services/analytics.service'

async function main(): Promise<void> {
  MongoPoolManager.initialize({
    user: env.MONGO_USER,
    pass: env.MONGO_PASS,
    host: env.MONGO_HOST,
    db: env.MONGO_DBNAME,
    replicaSet: env.MONGO_REPLICASET,
  })

  const overview = await getAnalyticsOverview(env.CHAIN_ID)
  console.log(JSON.stringify(overview, null, 2))
  await MongoPoolManager.getInstance().close()
}

void main().catch(async (error) => {
  console.error(error)
  try {
    await MongoPoolManager.getInstance().close()
  } catch {
    // ignore
  }
  process.exit(1)
})
