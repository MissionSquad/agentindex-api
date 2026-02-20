/** ERC-8004 contract addresses (Ethereum mainnet) */
export const ERC8004_CONTRACTS = {
  IDENTITY_REGISTRY: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'.toLowerCase(),
  REPUTATION_REGISTRY: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63'.toLowerCase(),
} as const

/** All tracked contract addresses */
export const TRACKED_ADDRESSES = new Set([
  ERC8004_CONTRACTS.IDENTITY_REGISTRY,
  ERC8004_CONTRACTS.REPUTATION_REGISTRY,
])

/** Phase 1 write function selectors (first 4 bytes of keccak256 of signature) */
export const TRACKED_SELECTORS = new Set([
  '0x1aa3a008', // register()
  '0xf2c298be', // register(string)
  '0x8ea42286', // register(string,(string,bytes)[])
  '0x0af28bd3', // setAgentURI(uint256,string)
  '0x466648da', // setMetadata(uint256,string,bytes)
  '0x2d1ef5ae', // setAgentWallet(uint256,address,uint256,bytes)
  '0x3fddcf19', // unsetAgentWallet(uint256)
  '0x23b872dd', // transferFrom(address,address,uint256)
  '0x42842e0e', // safeTransferFrom(address,address,uint256)
  '0xb88d4fde', // safeTransferFrom(address,address,uint256,bytes)
  '0xa22cb465', // setApprovalForAll(address,bool)
  '0x3c036a7e', // giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)
  '0xc2349ab2', // appendResponse(uint256,address,uint64,string,bytes32)
  '0x4ab3ca99', // revokeFeedback(uint256,uint64)
])

/** Event topic0 decode map (ABI-verified) */
export const EVENT_TOPIC0 = {
  Transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  Registered: '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a',
  URIUpdated: '0x3a2c7fffc2cba7582c690e3b82c453ea02a308326a98a3ad7576c606336409fb',
  MetadataSet: '0x2c149ed548c6d2993cd73efe187df6eccabe4538091b33adbd25fafdb8a1468b',
  MetadataUpdate: '0xf8e1a15aba9398e019f0b49df1a4fde98ee17ae345cb5f6b5e2c27f5033e8ce7',
  ApprovalForAll: '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31',
  NewFeedback: '0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc',
  FeedbackRevoked: '0x25156fd3288212246d8b008d5921fde376c71ed14ac2e072a506eb06fde6d09d',
  ResponseAppended: '0xb1c6be0b5b8aef6539e2fac0fd131a2faa7b49edf8e505b5eb0ad487d56051d4',
} as const

/** Reverse lookup from topic0 to event name */
export const TOPIC0_TO_EVENT_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(EVENT_TOPIC0).map(([name, topic]) => [topic, name])
)

/**
 * Argument normalization rules per function.
 * Maps raw arg names to normalized names.
 */
export const ARG_NORMALIZATION: Record<string, Record<string, string>> = {
  'transferFrom(address,address,uint256)': {
    _from: 'from',
    _to: 'to',
    _value: 'tokenId',
  },
  'safeTransferFrom(address,address,uint256)': {
    from: 'from',
    to: 'to',
    tokenId: 'tokenId',
  },
  'safeTransferFrom(address,address,uint256,bytes)': {
    from: 'from',
    to: 'to',
    tokenId: 'tokenId',
    data: 'data',
  },
  'register(string)': {
    agentURI: 'uri',
  },
  'register(string,(string,bytes)[])': {
    agentURI: 'uri',
    metadata: 'metadata',
  },
  'setAgentURI(uint256,string)': {
    agentId: 'agentId',
    newURI: 'uri',
  },
}

/** Zero address constant */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** Zero hash constant */
export const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000'
