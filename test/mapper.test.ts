import { describe, it, expect } from 'vitest'
import { mapTransactionFact, mapCallFact, mapEventFacts } from '../src/services/mapper.service'
import type { DecodedTransaction } from '../src/types/evm'
import { ERC8004_CONTRACTS, EVENT_TOPIC0 } from '../src/config/erc8004'

const CHAIN_ID = 1

function makeDecodedTransaction(overrides: Partial<DecodedTransaction['transaction']> = {}): DecodedTransaction {
  return {
    transaction: {
      hash: '0x1086a38e331bbdff013772175f65e29c082e1882cbfe03d0a700429c3a10263b',
      from: '0xFe90787F976f145059a8FCE71d99a006a209FC48',
      to: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
      gas: 656780,
      gasPrice: 33605621,
      nonce: 3,
      value: 0,
      blockHash: '0x30555d61be5dee4430918bda04383d46274ad9ced43ee0d1af8f4a836ef33042',
      blockNumber: 24473343,
      transactionIndex: 284,
      status: 'success',
      contractAddress: null,
      cumulativeGasUsed: 47958743,
      gasUsed: 644218,
      maxFeePerGas: 41438716,
      maxPriorityFeePerGas: 15,
      timestamp: 1771292615000,
      call: {
        name: 'register',
        signature: 'register(string)',
        params: [{ name: 'agentURI', type: 'string', value: 'data:application/json;base64,abc' }],
        args: { agentURI: 'data:application/json;base64,abc' },
      },
      ...overrides,
    },
    logEvents: [
      {
        removed: false,
        logIndex: 1531,
        blockNumber: 24473343,
        blockHash: '0x30555d61be5dee4430918bda04383d46274ad9ced43ee0d1af8f4a836ef33042',
        transactionHash: '0x1086a38e331bbdff013772175f65e29c082e1882cbfe03d0a700429c3a10263b',
        transactionIndex: 284,
        address: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
        data: '0x',
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x000000000000000000000000fe90787f976f145059a8fce71d99a006a209fc48',
          '0x0000000000000000000000000000000000000000000000000000000000006383',
        ],
        event: {
          name: 'Transfer',
          signature: 'Transfer(address,address,uint256)',
          params: [
            { name: 'from', type: 'address', value: '0x0000000000000000000000000000000000000000' },
            { name: 'to', type: 'address', value: '0xFe90787F976f145059a8FCE71d99a006a209FC48' },
            { name: 'tokenId', type: 'uint256', value: 25475 },
          ],
          args: {
            from: '0x0000000000000000000000000000000000000000',
            to: '0xFe90787F976f145059a8FCE71d99a006a209FC48',
            tokenId: 25475,
          },
        },
      },
      {
        removed: false,
        logIndex: 1533,
        blockNumber: 24473343,
        blockHash: '0x30555d61be5dee4430918bda04383d46274ad9ced43ee0d1af8f4a836ef33042',
        transactionHash: '0x1086a38e331bbdff013772175f65e29c082e1882cbfe03d0a700429c3a10263b',
        transactionIndex: 284,
        address: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
        data: '0x...',
        topics: [
          '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a',
          '0x0000000000000000000000000000000000000000000000000000000000006383',
          '0x000000000000000000000000fe90787f976f145059a8fce71d99a006a209fc48',
        ],
        event: {
          name: 'Registered',
          signature: 'Registered(uint256,string,address)',
          params: [
            { name: 'agentId', type: 'uint256', value: 25475 },
            { name: 'agentURI', type: 'string', value: 'data:application/json;base64,abc' },
            { name: 'owner', type: 'address', value: '0xFe90787F976f145059a8FCE71d99a006a209FC48' },
          ],
          args: {
            agentId: 25475,
            agentURI: 'data:application/json;base64,abc',
            owner: '0xFe90787F976f145059a8FCE71d99a006a209FC48',
          },
        },
      },
    ],
  }
}

describe('mapTransactionFact', () => {
  it('maps a decoded register transaction to a TransactionFact', () => {
    const decoded = makeDecodedTransaction()
    const fact = mapTransactionFact(CHAIN_ID, decoded)

    expect(fact.id).toBe('1:0x1086a38e331bbdff013772175f65e29c082e1882cbfe03d0a700429c3a10263b')
    expect(fact.chainId).toBe(1)
    expect(fact.registryAddress).toBe(ERC8004_CONTRACTS.IDENTITY_REGISTRY)
    expect(fact.txHash).toBe('0x1086a38e331bbdff013772175f65e29c082e1882cbfe03d0a700429c3a10263b')
    expect(fact.blockNumber).toBe(24473343)
    expect(fact.status).toBe('success')
    expect(fact.from).toBe('0xfe90787f976f145059a8fce71d99a006a209fc48')
    expect(fact.to).toBe(ERC8004_CONTRACTS.IDENTITY_REGISTRY)
    expect(fact.nonce).toBe(3)
    expect(fact.gasUsed).toBe(644218)
    expect(fact.maxFeePerGas).toBe(41438716)
    expect(fact.maxPriorityFeePerGas).toBe(15)
  })

  it('sets maxFeePerGas to null when absent', () => {
    const decoded = makeDecodedTransaction({ maxFeePerGas: undefined, maxPriorityFeePerGas: undefined })
    const fact = mapTransactionFact(CHAIN_ID, decoded)

    expect(fact.maxFeePerGas).toBeNull()
    expect(fact.maxPriorityFeePerGas).toBeNull()
  })
})

describe('mapCallFact', () => {
  it('maps a register(string) call to a CallFact', () => {
    const decoded = makeDecodedTransaction()
    const fact = mapCallFact(CHAIN_ID, decoded)

    expect(fact).not.toBeNull()
    expect(fact!.functionName).toBe('register')
    expect(fact!.functionSignature).toBe('register(string)')
    expect(fact!.rawArgs).toEqual({ agentURI: 'data:application/json;base64,abc' })
    // Normalized: agentURI -> uri
    expect(fact!.normalizedArgs).toEqual({ uri: 'data:application/json;base64,abc' })
  })

  it('returns null when call is absent', () => {
    const decoded = makeDecodedTransaction({ call: undefined })
    const fact = mapCallFact(CHAIN_ID, decoded)
    expect(fact).toBeNull()
  })

  it('normalizes transferFrom args correctly', () => {
    const decoded = makeDecodedTransaction({
      call: {
        name: 'transferFrom',
        signature: 'transferFrom(address,address,uint256)',
        params: [],
        args: { _from: '0xaaa', _to: '0xbbb', _value: 123 },
      },
    })
    const fact = mapCallFact(CHAIN_ID, decoded)
    expect(fact!.normalizedArgs).toEqual({ from: '0xaaa', to: '0xbbb', tokenId: 123 })
    // Raw args remain untouched
    expect(fact!.rawArgs).toEqual({ _from: '0xaaa', _to: '0xbbb', _value: 123 })
  })

  it('normalizes setAgentURI args correctly', () => {
    const decoded = makeDecodedTransaction({
      call: {
        name: 'setAgentURI',
        signature: 'setAgentURI(uint256,string)',
        params: [],
        args: { agentId: 22899, newURI: 'ipfs://cid123' },
      },
    })
    const fact = mapCallFact(CHAIN_ID, decoded)
    expect(fact!.normalizedArgs).toEqual({ agentId: 22899, uri: 'ipfs://cid123' })
  })
})

describe('mapEventFacts', () => {
  it('maps decoded log events to EventFact documents', () => {
    const decoded = makeDecodedTransaction()
    const facts = mapEventFacts(CHAIN_ID, decoded)

    // Should include Transfer and Registered (both from Identity Registry)
    expect(facts.length).toBe(2)

    const transferFact = facts.find((f) => f.eventName === 'Transfer')!
    expect(transferFact).toBeDefined()
    expect(transferFact.topic0).toBe('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef')
    expect(transferFact.logIndex).toBe(1531)
    expect(transferFact.eventArgs['from']).toBe('0x0000000000000000000000000000000000000000')
    expect(transferFact.eventArgs['to']).toBe('0xFe90787F976f145059a8FCE71d99a006a209FC48')
    expect(transferFact.eventArgs['tokenId']).toBe(25475)

    const registeredFact = facts.find((f) => f.eventName === 'Registered')!
    expect(registeredFact).toBeDefined()
    expect(registeredFact.eventArgs['agentId']).toBe(25475)
    expect(registeredFact.eventArgs['owner']).toBe('0xFe90787F976f145059a8FCE71d99a006a209FC48')
  })

  it('excludes events from non-tracked addresses', () => {
    const decoded = makeDecodedTransaction()
    // Change the address of the first log event to a non-tracked address
    decoded.logEvents[0].address = '0x1111111111111111111111111111111111111111'
    const facts = mapEventFacts(CHAIN_ID, decoded)

    // Only the Registered event should remain
    expect(facts.length).toBe(1)
    expect(facts[0].eventName).toBe('Registered')
  })

  it('handles missing event decode gracefully', () => {
    const decoded = makeDecodedTransaction()
    decoded.logEvents[0].event = undefined
    const facts = mapEventFacts(CHAIN_ID, decoded)

    const transferFact = facts.find((f) => f.logIndex === 1531)!
    expect(transferFact.eventName).toBe('Transfer')
    expect(transferFact.eventSignature).toBe('')
    expect(transferFact.eventArgs).toEqual({})
  })

  it('supplements NewFeedback eventArgs from call.args when event decode is missing', () => {
    const feedbackIndexHex = '000000000000000000000000000000000000000000000000000000000000002a' // 42
    const decoded: DecodedTransaction = {
      transaction: {
        hash: '0xabc123',
        from: '0xClientAddr',
        to: ERC8004_CONTRACTS.REPUTATION_REGISTRY,
        gas: 100000,
        gasPrice: 1000,
        nonce: 1,
        value: 0,
        blockHash: '0xblockhash',
        blockNumber: 100,
        transactionIndex: 0,
        status: 'success',
        contractAddress: null,
        cumulativeGasUsed: 50000,
        gasUsed: 40000,
        maxFeePerGas: 2000,
        maxPriorityFeePerGas: 10,
        timestamp: 1700000000000,
        call: {
          name: 'giveFeedback',
          signature: 'giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)',
          params: [],
          args: {
            agentId: 10307,
            value: 100,
            valueDecimals: 0,
            tag1: 'quality',
            tag2: 'chat-bot',
            endpoint: 'https://example.com',
            feedbackURI: 'data:application/json;base64,xyz',
            feedbackHash: '0xfeedhash',
          },
        },
      },
      logEvents: [
        {
          removed: false,
          logIndex: 5,
          blockNumber: 100,
          blockHash: '0xblockhash',
          transactionHash: '0xabc123',
          transactionIndex: 0,
          address: ERC8004_CONTRACTS.REPUTATION_REGISTRY,
          data: '0x' + feedbackIndexHex + 'ff'.repeat(32), // feedbackIndex = 42, followed by more data
          topics: [
            EVENT_TOPIC0.NewFeedback,
            '0x0000000000000000000000000000000000000000000000000000000000002843', // agentId indexed
            '0x000000000000000000000000clientaddr000000000000000000000000000000', // clientAddress indexed
            '0x0000000000000000000000000000000000000000000000000000000000000000', // indexedTag1 (hash)
          ],
          event: undefined, // ABI decode missing
        },
      ],
    }

    const facts = mapEventFacts(CHAIN_ID, decoded)
    expect(facts.length).toBe(1)

    const fb = facts[0]
    expect(fb.eventName).toBe('NewFeedback')
    expect(fb.eventArgs['agentId']).toBe(10307)
    expect(fb.eventArgs['clientAddress']).toBe('0xClientAddr')
    expect(fb.eventArgs['value']).toBe(100)
    expect(fb.eventArgs['valueDecimals']).toBe(0)
    expect(fb.eventArgs['tag1']).toBe('quality')
    expect(fb.eventArgs['tag2']).toBe('chat-bot')
    expect(fb.eventArgs['endpoint']).toBe('https://example.com')
    expect(fb.eventArgs['feedbackURI']).toBe('data:application/json;base64,xyz')
    expect(fb.eventArgs['feedbackHash']).toBe('0xfeedhash')
    expect(fb.eventArgs['feedbackIndex']).toBe(42)
  })

  it('supplements Registered eventArgs from call.args when event decode is missing', () => {
    const decoded = makeDecodedTransaction()
    // Remove event decode from the Registered log event
    decoded.logEvents[1].event = undefined

    const facts = mapEventFacts(CHAIN_ID, decoded)
    const registeredFact = facts.find((f) => f.eventName === 'Registered')!
    expect(registeredFact).toBeDefined()
    expect(registeredFact.eventArgs['agentId']).toBe(25475)
    expect(registeredFact.eventArgs['owner']).toBe('0xFe90787F976f145059a8FCE71d99a006a209FC48')
    expect(registeredFact.eventArgs['agentURI']).toBe('data:application/json;base64,abc')
  })

  it('does not supplement when event args are already decoded', () => {
    const decoded = makeDecodedTransaction()
    // Registered event already has decoded args — should remain untouched
    const facts = mapEventFacts(CHAIN_ID, decoded)
    const registeredFact = facts.find((f) => f.eventName === 'Registered')!
    expect(registeredFact.eventArgs['agentId']).toBe(25475)
    expect(registeredFact.eventArgs['owner']).toBe('0xFe90787F976f145059a8FCE71d99a006a209FC48')
  })

  it('supplements FeedbackRevoked eventArgs from call.args', () => {
    const decoded: DecodedTransaction = {
      transaction: {
        hash: '0xrevoke123',
        from: '0xClientAddr',
        to: ERC8004_CONTRACTS.REPUTATION_REGISTRY,
        gas: 100000,
        gasPrice: 1000,
        nonce: 2,
        value: 0,
        blockHash: '0xblockhash',
        blockNumber: 200,
        transactionIndex: 1,
        status: 'success',
        contractAddress: null,
        cumulativeGasUsed: 60000,
        gasUsed: 50000,
        maxFeePerGas: 2000,
        maxPriorityFeePerGas: 10,
        timestamp: 1700000000000,
        call: {
          name: 'revokeFeedback',
          signature: 'revokeFeedback(uint256,uint64)',
          params: [],
          args: { agentId: 555, feedbackIndex: 7 },
        },
      },
      logEvents: [
        {
          removed: false,
          logIndex: 10,
          blockNumber: 200,
          blockHash: '0xblockhash',
          transactionHash: '0xrevoke123',
          transactionIndex: 1,
          address: ERC8004_CONTRACTS.REPUTATION_REGISTRY,
          data: '0x',
          topics: [
            EVENT_TOPIC0.FeedbackRevoked,
            '0x000000000000000000000000000000000000000000000000000000000000022b', // agentId = 555
            '0x000000000000000000000000clientaddr000000000000000000000000000000',
            '0x0000000000000000000000000000000000000000000000000000000000000007', // feedbackIndex = 7
          ],
          event: undefined,
        },
      ],
    }

    const facts = mapEventFacts(CHAIN_ID, decoded)
    expect(facts.length).toBe(1)
    expect(facts[0].eventArgs['agentId']).toBe(555)
    expect(facts[0].eventArgs['clientAddress']).toBe('0xClientAddr')
    expect(facts[0].eventArgs['feedbackIndex']).toBe(7)
  })

  it('supplements ResponseAppended eventArgs from call.args', () => {
    const decoded: DecodedTransaction = {
      transaction: {
        hash: '0xresponse456',
        from: '0xResponderAddr',
        to: ERC8004_CONTRACTS.REPUTATION_REGISTRY,
        gas: 100000,
        gasPrice: 1000,
        nonce: 5,
        value: 0,
        blockHash: '0xblockhash',
        blockNumber: 300,
        transactionIndex: 2,
        status: 'success',
        contractAddress: null,
        cumulativeGasUsed: 70000,
        gasUsed: 60000,
        maxFeePerGas: 3000,
        maxPriorityFeePerGas: 15,
        timestamp: 1700000000000,
        call: {
          name: 'appendResponse',
          signature: 'appendResponse(uint256,address,uint64,string,bytes32)',
          params: [],
          args: {
            agentId: 888,
            clientAddress: '0xOriginalClient',
            feedbackIndex: 3,
            responseURI: 'ipfs://resp123',
            responseHash: '0xresphash',
          },
        },
      },
      logEvents: [
        {
          removed: false,
          logIndex: 20,
          blockNumber: 300,
          blockHash: '0xblockhash',
          transactionHash: '0xresponse456',
          transactionIndex: 2,
          address: ERC8004_CONTRACTS.REPUTATION_REGISTRY,
          data: '0x',
          topics: [
            EVENT_TOPIC0.ResponseAppended,
            '0x0000000000000000000000000000000000000000000000000000000000000378', // agentId = 888
            '0x000000000000000000000000originalclient00000000000000000000000000',
            '0x000000000000000000000000responderaddr0000000000000000000000000000',
          ],
          event: undefined,
        },
      ],
    }

    const facts = mapEventFacts(CHAIN_ID, decoded)
    expect(facts.length).toBe(1)
    expect(facts[0].eventArgs['agentId']).toBe(888)
    expect(facts[0].eventArgs['clientAddress']).toBe('0xOriginalClient')
    expect(facts[0].eventArgs['responder']).toBe('0xResponderAddr')
    expect(facts[0].eventArgs['feedbackIndex']).toBe(3)
    expect(facts[0].eventArgs['responseURI']).toBe('ipfs://resp123')
    expect(facts[0].eventArgs['responseHash']).toBe('0xresphash')
  })
})
