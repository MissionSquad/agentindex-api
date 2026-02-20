import { MongoClient, Db, Collection, Document, MongoClientOptions, ReadPreference } from 'mongodb'
import { log } from './logger'
import { env } from '../env'
import { MongoDBClient, IndexDefinition, MongoConnectionParams, objectMapString } from './mongodb'
import { retryWithBackoff } from './retry'

/**
 * Singleton manager for MongoDB connection pooling.
 * Maintains a single MongoClient instance shared across all database operations.
 */
export class MongoPoolManager {
  private static instance: MongoPoolManager | null = null
  private client: MongoClient | null = null
  private db: Db | null = null
  private readonly url: string
  private readonly dbName: string
  private readonly options: MongoClientOptions
  private isConnected: boolean = false
  private connectPromise: Promise<void> | null = null

  private constructor(params: MongoConnectionParams) {
    const {
      host,
      db,
      user,
      pass,
      authDB,
      replicaSet,
      connectTimeoutMs = env.MONGO_CONNECT_TIMEOUT_MS,
      socketTimeoutMs = env.MONGO_SOCKET_TIMEOUT_MS,
      maxPoolSize = env.MONGO_MAX_POOL_SIZE,
      minPoolSize = env.MONGO_MIN_POOL_SIZE,
    } = params

    this.url = host.includes('://') ? host : `mongodb://${host}`
    this.dbName = db

    this.options = {
      auth: {
        username: user,
        password: pass,
      },
      connectTimeoutMS: connectTimeoutMs,
      socketTimeoutMS: socketTimeoutMs,
      maxPoolSize,
      minPoolSize,
    }

    if (authDB) {
      this.options.authSource = authDB
    }

    if (replicaSet) {
      this.options.replicaSet = replicaSet
      this.options.readPreference = ReadPreference.PRIMARY_PREFERRED
      this.options.writeConcern = { w: 'majority' }
      this.options.retryWrites = true
    }
  }

  public static initialize(params: MongoConnectionParams): void {
    if (MongoPoolManager.instance === null) {
      MongoPoolManager.instance = new MongoPoolManager(params)
      log({ level: 'info', msg: 'MongoPoolManager initialized' })
    }
  }

  public static getInstance(): MongoPoolManager {
    if (MongoPoolManager.instance === null) {
      throw new Error('MongoPoolManager not initialized. Call MongoPoolManager.initialize() first.')
    }
    return MongoPoolManager.instance
  }

  private async ensureConnected(): Promise<void> {
    if (this.isConnected && this.client !== null && this.db !== null) {
      return
    }
    if (this.connectPromise !== null) {
      return this.connectPromise
    }
    this.connectPromise = this.connect()
    try {
      await this.connectPromise
    } finally {
      this.connectPromise = null
    }
  }

  private async connect(): Promise<void> {
    log({ level: 'info', msg: `Connecting to MongoDB at ${this.url}...` })

    await retryWithBackoff(
      async () => {
        this.client = new MongoClient(this.url, this.options)
        await this.client.connect()
        this.db = this.client.db(this.dbName)
        this.isConnected = true
        log({ level: 'info', msg: `Connected to MongoDB database: ${this.dbName}` })
      },
      env.MAX_MONGO_CONNECT_RETRIES,
      env.MONGO_CONNECT_BASE_DELAY_MS,
    )
  }

  public async createClient<T extends Document>(
    collectionName: string,
    indexes: IndexDefinition[] = [],
  ): Promise<MongoDBClient<T>> {
    await this.ensureConnected()

    if (this.db === null) {
      throw new Error('Database not initialized after connection')
    }

    const collections = await this.db.listCollections().toArray()
    const collectionNames = collections.map(({ name }) => name)

    let collection: Collection<T>
    if (!collectionNames.includes(collectionName)) {
      collection = await this.db.createCollection<T>(collectionName)
      log({ level: 'info', msg: `Created collection: ${collectionName}` })
    } else {
      collection = this.db.collection<T>(collectionName)
    }

    if (indexes.length > 0) {
      const existingIndexes = await collection.indexes()
      const existingIndexMaps = existingIndexes.map(({ key }) => objectMapString(key as Record<string, unknown>))

      for (const def of indexes) {
        const indexMap = objectMapString(def.key as Record<string, unknown>)
        if (!existingIndexMaps.includes(indexMap)) {
          await collection.createIndexes([{ ...def }])
          log({ level: 'info', msg: `Created index ${def.name} on ${collectionName}` })
        }
      }
    }

    return new MongoDBClient<T>(collection, this.db)
  }

  public async close(): Promise<void> {
    if (this.client !== null) {
      await this.client.close()
      this.client = null
      this.db = null
      this.isConnected = false
      log({ level: 'info', msg: 'MongoDB connection closed' })
    }
  }

  public static async reset(): Promise<void> {
    if (MongoPoolManager.instance !== null) {
      await MongoPoolManager.instance.close()
      MongoPoolManager.instance = null
    }
  }
}
