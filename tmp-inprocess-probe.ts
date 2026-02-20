import express from 'express'
import request from 'supertest'
import { createAnalyticsRouter } from './src/controllers/analytics.controller'
import { MongoPoolManager } from './src/utils/mongoPoolManager'
import { env } from './src/env'

async function main(): Promise<void> {
  MongoPoolManager.initialize({
    user: env.MONGO_USER,
    pass: env.MONGO_PASS,
    host: env.MONGO_HOST,
    db: env.MONGO_DBNAME,
    replicaSet: env.MONGO_REPLICASET,
  })

  const app = express()
  app.use('/v1/analytics', createAnalyticsRouter())

  const res = await request(app).get('/v1/analytics/overview').query({ chainId: env.CHAIN_ID })
  console.log('status=', res.status)
  console.log(JSON.stringify({
    keys: Object.keys(res.body ?? {}),
    hasDashboardMetrics: Boolean(res.body?.dashboardMetrics),
    hasCharts: Boolean(res.body?.charts),
    error: res.body?.error ?? null,
  }, null, 2))

  await MongoPoolManager.getInstance().close()
}

void main().catch(async (error) => {
  console.error(error)
  try {
    await MongoPoolManager.getInstance().close()
  } catch {
    // ignore close errors
  }
  process.exit(1)
})
