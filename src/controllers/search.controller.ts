import { Router, Request, Response } from 'express'
import type { Document } from 'mongodb'
import { getEventFactClient } from '../repositories/event.repository'
import { getTxFactClient } from '../repositories/transaction.repository'
import { env } from '../env'

export function createSearchRouter(): Router {
  const router = Router()

  /**
   * GET /v1/search?q=<query>
   * Global search. Resolves agent IDs, addresses, tx hashes, and text.
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string ?? '').trim()
      if (!q) {
        res.status(400).json({ error: 'Query parameter "q" is required' })
        return
      }

      const parsedPage = parseInt(req.query.page as string, 10)
      const page = !isNaN(parsedPage) && parsedPage > 0 ? parsedPage : 1
      const parsedLimit = parseInt(req.query.limit as string, 10)
      const limit = !isNaN(parsedLimit) ? Math.max(1, Math.min(100, parsedLimit)) : 25
      const skip = (page - 1) * limit

      const chainId = parseInt(req.query.chainId as string, 10) || env.CHAIN_ID
      const eventDb = await getEventFactClient()
      const txDb = await getTxFactClient()
      const results: Array<{
        type: 'agent' | 'address' | 'transaction' | 'tag' | 'endpoint'
        id: string
        title: string
        subtitle: string
        route: string
      }> = []

      const dedupe = new Set<string>()
      const pushResult = (item: {
        type: 'agent' | 'address' | 'transaction' | 'tag' | 'endpoint'
        id: string
        title: string
        subtitle: string
        route: string
      }): void => {
        const key = `${item.type}:${item.id}:${item.route}`
        if (dedupe.has(key)) return
        dedupe.add(key)
        results.push(item)
      }

      // 1. Check if it's a numeric agent ID
      const numericId = parseInt(q, 10)
      if (!isNaN(numericId) && String(numericId) === q) {
        const registration = await eventDb.findOne({
          chainId,
          eventName: 'Registered',
          'eventArgs.agentId': numericId,
        } as Document)

        if (registration) {
          pushResult({
            type: 'agent',
            id: String(numericId),
            title: `Agent ${numericId}`,
            subtitle: `Registered at block ${registration.blockNumber}`,
            route: `/agents/${numericId}`,
          })
        }
      }

      // 2. Check if it's an Ethereum address
      if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
        const address = q.toLowerCase()
        const txCount = await txDb.count({
          chainId,
          $or: [{ from: address }, { to: address }],
        } as Document)

        pushResult({
          type: 'address',
          id: address,
          title: address,
          subtitle: `${txCount} related transactions`,
          route: `/address/${address}`,
        })
      }

      // 3. Check if it's a transaction hash
      if (/^0x[0-9a-fA-F]{64}$/.test(q)) {
        const txHash = q.toLowerCase()
        const tx = await txDb.findOne({ chainId, txHash })

        if (tx) {
          pushResult({
            type: 'transaction',
            id: txHash,
            title: txHash,
            subtitle: `Block ${tx.blockNumber}`,
            route: `/tx/${txHash}`,
          })
        }
      }

      // 4. Text search against tags and endpoint data
      const feedbackRows = await eventDb.find(
        {
          chainId,
          eventName: 'NewFeedback',
          $or: [
            { 'eventArgs.tag1': { $regex: q, $options: 'i' } },
            { 'eventArgs.tag2': { $regex: q, $options: 'i' } },
            { 'eventArgs.endpoint': { $regex: q, $options: 'i' } },
          ],
        } as Document,
        { blockNumber: -1 },
        100,
      )

      for (const row of feedbackRows) {
        const eventArgs = row.eventArgs as Record<string, unknown>
        const agentId = eventArgs['agentId']
        const tag1 = eventArgs['tag1']
        const tag2 = eventArgs['tag2']
        const endpoint = eventArgs['endpoint']

        if (typeof tag1 === 'string' && tag1.toLowerCase().includes(q.toLowerCase())) {
          pushResult({
            type: 'tag',
            id: `tag:${tag1.toLowerCase()}`,
            title: `Tag: ${tag1}`,
            subtitle: `Agent ${String(agentId ?? 'unknown')}`,
            route: `/reputation?tag=${encodeURIComponent(tag1)}`,
          })
        }

        if (typeof tag2 === 'string' && tag2.toLowerCase().includes(q.toLowerCase())) {
          pushResult({
            type: 'tag',
            id: `tag:${tag2.toLowerCase()}`,
            title: `Tag: ${tag2}`,
            subtitle: `Agent ${String(agentId ?? 'unknown')}`,
            route: `/reputation?tag=${encodeURIComponent(tag2)}`,
          })
        }

        if (typeof endpoint === 'string' && endpoint.toLowerCase().includes(q.toLowerCase())) {
          pushResult({
            type: 'endpoint',
            id: `endpoint:${endpoint.toLowerCase()}`,
            title: `Endpoint: ${endpoint}`,
            subtitle: `Agent ${String(agentId ?? 'unknown')}`,
            route: `/reputation?endpoint=${encodeURIComponent(endpoint)}`,
          })
        }
      }

      const total = results.length
      const paginated = results.slice(skip, skip + limit)

      res.json({
        query: q,
        results: {
          items: paginated,
          meta: {
            page,
            limit,
            total,
            hasNextPage: page * limit < total,
          },
        },
      })
    } catch (error) {
      res.status(500).json({ error: 'Search failed' })
    }
  })

  return router
}
