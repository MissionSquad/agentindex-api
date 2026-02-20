import {
  BulkWriteResult,
  Collection,
  Db,
  DeleteResult,
  Document,
  Filter,
  IndexDescription,
  InsertOneResult,
  Sort,
  UpdateResult,
  OptionalUnlessRequiredId,
} from 'mongodb'

export const objectMapString = (input: { [key: string]: unknown }): string =>
  Object.entries(input)
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce((acc, [k, v]) => `${acc}${k}${v}`, '')

export interface IndexDefinition extends Omit<IndexDescription, 'name'> {
  name: string
}

export interface MongoConnectionParams {
  host: string
  db: string
  user: string
  pass: string
  authDB?: string
  replicaSet?: string
  connectTimeoutMs?: number
  socketTimeoutMs?: number
  maxPoolSize?: number
  minPoolSize?: number
}

/**
 * Generic typed MongoDB data access wrapper.
 * Connection management is handled by MongoPoolManager.
 */
export class MongoDBClient<T extends Document> {
  private collection: Collection<T>
  private db: Db

  constructor(collection: Collection<T>, db: Db) {
    this.collection = collection
    this.db = db
  }

  async insert(item: OptionalUnlessRequiredId<T>): Promise<InsertOneResult<T>> {
    return this.collection.insertOne(item)
  }

  async upsert(item: Partial<T>, filter: Filter<T>): Promise<UpdateResult<T>> {
    return this.collection.updateOne(filter, { $set: item }, { upsert: true })
  }

  async upsertBulk(items: Array<{ item: Partial<T>; filter: Filter<T> }>): Promise<BulkWriteResult> {
    if (items.length === 0) return { ok: 1 } as unknown as BulkWriteResult
    return this.collection.bulkWrite(
      items.map(({ item, filter }) => ({
        updateOne: { filter, update: { $set: item }, upsert: true },
      }))
    )
  }

  async find(filter: Filter<T>, sort?: Sort, limit?: number, skip?: number): Promise<Array<T>> {
    const results = await this.collection.find(filter, { sort, limit, skip }).toArray()
    return results.map((doc) => {
      const { _id, ...item } = doc as Record<string, unknown>
      return item as T
    })
  }

  async findOne(filter: Filter<T>, sort?: Sort): Promise<T | null> {
    const result = await this.collection.findOne(filter, { sort })
    if (result != null) {
      const { _id, ...item } = result as Record<string, unknown>
      return item as T
    }
    return null
  }

  async count(filter: Filter<T>): Promise<number> {
    return this.collection.countDocuments(filter)
  }

  async aggregate<TResult extends Document = Document>(pipeline: Document[]): Promise<TResult[]> {
    return this.collection.aggregate<TResult>(pipeline).toArray()
  }

  async distinct(field: string, filter: Filter<T>): Promise<unknown[]> {
    return this.collection.distinct(field, filter)
  }

  async delete(filter: Filter<T>): Promise<DeleteResult> {
    return this.collection.deleteMany(filter)
  }
}
