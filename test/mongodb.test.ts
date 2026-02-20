import { describe, it, expect, vi } from 'vitest'
import { objectMapString, MongoDBClient } from '../src/utils/mongodb'

describe('objectMapString', () => {
  it('serializes object entries sorted by key', () => {
    const result = objectMapString({ b: 2, a: 1, c: -1 })
    expect(result).toBe('a1b2c-1')
  })

  it('returns empty string for empty object', () => {
    expect(objectMapString({})).toBe('')
  })

  it('handles string values', () => {
    const result = objectMapString({ name: 'test' })
    expect(result).toBe('nametest')
  })
})

function createMockCollection() {
  return {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'id1' }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    bulkWrite: vi.fn().mockResolvedValue({ ok: 1 }),
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: 'oid1', name: 'doc1' },
        { _id: 'oid2', name: 'doc2' },
      ]),
    }),
    findOne: vi.fn().mockResolvedValue({ _id: 'oid1', name: 'doc1' }),
    countDocuments: vi.fn().mockResolvedValue(42),
    aggregate: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ count: 10 }]),
    }),
    distinct: vi.fn().mockResolvedValue(['a', 'b', 'c']),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 3 }),
  }
}

describe('MongoDBClient', () => {
  it('insert delegates to collection.insertOne', async () => {
    const col = createMockCollection()
    const client = new MongoDBClient(col as any, {} as any)

    const result = await client.insert({ name: 'test' } as any)
    expect(col.insertOne).toHaveBeenCalledWith({ name: 'test' })
    expect(result).toEqual({ insertedId: 'id1' })
  })

  it('upsert delegates to collection.updateOne with upsert:true', async () => {
    const col = createMockCollection()
    const client = new MongoDBClient(col as any, {} as any)

    await client.upsert({ name: 'updated' }, { id: '1' } as any)
    expect(col.updateOne).toHaveBeenCalledWith(
      { id: '1' },
      { $set: { name: 'updated' } },
      { upsert: true },
    )
  })

  it('upsertBulk returns early for empty array', async () => {
    const col = createMockCollection()
    const client = new MongoDBClient(col as any, {} as any)

    const result = await client.upsertBulk([])
    expect(col.bulkWrite).not.toHaveBeenCalled()
    expect((result as any).ok).toBe(1)
  })

  it('upsertBulk delegates to collection.bulkWrite', async () => {
    const col = createMockCollection()
    const client = new MongoDBClient(col as any, {} as any)

    await client.upsertBulk([
      { item: { name: 'a' } as any, filter: { id: '1' } as any },
      { item: { name: 'b' } as any, filter: { id: '2' } as any },
    ])
    expect(col.bulkWrite).toHaveBeenCalledOnce()
    const ops = col.bulkWrite.mock.calls[0][0]
    expect(ops).toHaveLength(2)
    expect(ops[0].updateOne.upsert).toBe(true)
  })

  it('find strips _id from results', async () => {
    const col = createMockCollection()
    const client = new MongoDBClient(col as any, {} as any)

    const results = await client.find({})
    expect(results).toEqual([{ name: 'doc1' }, { name: 'doc2' }])
    expect(col.find).toHaveBeenCalledWith({}, { sort: undefined, limit: undefined, skip: undefined })
  })

  it('find passes sort, limit, skip', async () => {
    const col = createMockCollection()
    const client = new MongoDBClient(col as any, {} as any)

    await client.find({ chainId: 1 } as any, { blockNumber: -1 }, 10, 20)
    expect(col.find).toHaveBeenCalledWith(
      { chainId: 1 },
      { sort: { blockNumber: -1 }, limit: 10, skip: 20 },
    )
  })

  it('findOne returns item without _id', async () => {
    const col = createMockCollection()
    const client = new MongoDBClient(col as any, {} as any)

    const result = await client.findOne({ id: '1' } as any)
    expect(result).toEqual({ name: 'doc1' })
  })

  it('findOne returns null when no document found', async () => {
    const col = createMockCollection()
    col.findOne.mockResolvedValue(null)
    const client = new MongoDBClient(col as any, {} as any)

    const result = await client.findOne({ id: 'missing' } as any)
    expect(result).toBeNull()
  })

  it('count delegates to collection.countDocuments', async () => {
    const col = createMockCollection()
    const client = new MongoDBClient(col as any, {} as any)

    const result = await client.count({ eventName: 'Transfer' } as any)
    expect(result).toBe(42)
    expect(col.countDocuments).toHaveBeenCalledWith({ eventName: 'Transfer' })
  })

  it('aggregate delegates to collection.aggregate', async () => {
    const col = createMockCollection()
    const client = new MongoDBClient(col as any, {} as any)

    const result = await client.aggregate([{ $match: {} }])
    expect(result).toEqual([{ count: 10 }])
    expect(col.aggregate).toHaveBeenCalledWith([{ $match: {} }])
  })

  it('distinct delegates to collection.distinct', async () => {
    const col = createMockCollection()
    const client = new MongoDBClient(col as any, {} as any)

    const result = await client.distinct('eventName', {})
    expect(result).toEqual(['a', 'b', 'c'])
    expect(col.distinct).toHaveBeenCalledWith('eventName', {})
  })

  it('delete delegates to collection.deleteMany', async () => {
    const col = createMockCollection()
    const client = new MongoDBClient(col as any, {} as any)

    const result = await client.delete({ chainId: 1 } as any)
    expect(result).toEqual({ deletedCount: 3 })
    expect(col.deleteMany).toHaveBeenCalledWith({ chainId: 1 })
  })
})
