const ATT = '(bytes32 invoiceHash,address payee,uint256 amount,uint8 role,uint8 verdict,uint16 confidenceBps,bytes32 evidenceHash,uint256 agentId,uint64 expiry,uint256 nonce)';
const REQ = '(bytes32 invoiceHash,address payee,uint256 amount,bytes32 category)';

/** The slice of the CosignPolicy ABI the Executor needs. A contracts test checks the selectors match the compiled artifact. */
export const POLICY_ABI = [
  `function release(${REQ} req, ${ATT}[] atts, bytes[] sigs, bytes humanSig)`,
  `function evaluate(${REQ} req, ${ATT}[] atts, bytes[] sigs, bytes humanSig) view returns (uint8 rule, uint8 detail)`,
  'function paid(bytes32) view returns (bool)',
  'function POLICY_VERSION() view returns (string)',
  'event Released(bytes32 indexed invoiceHash, address indexed payee, uint256 amount, bytes32 receiptHash, bool humanSigned)',
  'error RuleFailed(uint8 rule, uint8 detail)',
  'error NotExecutor()',
];

export const REGISTRY_ABI = ['function signerOf(uint256 agentId) view returns (address)'];

/** Read-only view of the registry, for dashboards and the keyless verifier. */
export const REGISTRY_READ_ABI = [
  ...REGISTRY_ABI,
  'function getAgent(uint256 agentId) view returns (tuple(address operator, address signer, uint8 role, uint128 bond, int32 score, bool active))',
  'function isEligible(uint256 agentId, uint8 role) view returns (bool)',
  'function auditor() view returns (address)',
  'function minBond() view returns (uint128)',
  'function minScore() view returns (int32)',
];

/** Must stay identical to contracts/CosignPolicy.sol and agents/src/eip712.ts. */
export const ATTESTATION_TYPES = {
  Attestation: [
    { name: 'invoiceHash', type: 'bytes32' },
    { name: 'payee', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'role', type: 'uint8' },
    { name: 'verdict', type: 'uint8' },
    { name: 'confidenceBps', type: 'uint16' },
    { name: 'evidenceHash', type: 'bytes32' },
    { name: 'agentId', type: 'uint256' },
    { name: 'expiry', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
  ],
};

export const HUMAN_APPROVAL_TYPES = {
  HumanApproval: [
    { name: 'invoiceHash', type: 'bytes32' },
    { name: 'payee', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'expiry', type: 'uint64' },
  ],
};
