// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AgentRegistry, Role} from "./AgentRegistry.sol";

/// @title CosignPolicy
/// @notice The single place that can release funds. Models give verdicts; this contract decides.
///         A payment is released only if all eight release rules pass. Any failure reverts, which means
///         nothing moves; the off-chain system then routes the payment to a human.
/// @dev The contract holds the USDC ("policy wallet"). Only `executor` can call `release`, and `release`
///      can only move funds that satisfy the rules. Use `evaluate` (a view) to learn which rule fails.
contract CosignPolicy is EIP712, Ownable {
    using SafeERC20 for IERC20;

    string public constant POLICY_VERSION = "policy-v0.1.0";

    enum Verdict {
        NONE, // zero value must never read as PASS
        PASS,
        FAIL,
        ESCALATE
    }

    /// @dev One signed verdict per role. Mirrors the PRD's attestation schema; the evidence CID is
    ///      committed as a bytes32 hash of the stored bundle's CID.
    struct Attestation {
        bytes32 invoiceHash;
        address payee;
        uint256 amount; // USDC base units (6 decimals)
        Role role;
        Verdict verdict;
        uint16 confidenceBps; // 0..10000
        bytes32 evidenceHash;
        uint256 agentId;
        uint64 expiry;
        uint256 nonce;
    }

    struct Request {
        bytes32 invoiceHash;
        address payee;
        uint256 amount;
        bytes32 category;
    }

    struct PayeeState {
        uint64 eligibleAt; // 0 = never allowlisted
        bool blocked; // sanctions hit or open challenge
    }

    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(bytes32 invoiceHash,address payee,uint256 amount,uint8 role,uint8 verdict,uint16 confidenceBps,bytes32 evidenceHash,uint256 agentId,uint64 expiry,uint256 nonce)"
    );
    bytes32 public constant HUMAN_APPROVAL_TYPEHASH =
        keccak256("HumanApproval(bytes32 invoiceHash,address payee,uint256 amount,uint64 expiry)");

    uint256 public constant REQUIRED_ROLES = 5;

    IERC20 public immutable usdc;
    AgentRegistry public immutable registry;

    address public executor;
    address public humanApprover;
    address public screener; // Verifier operator: allowlists payees, opens and resolves challenges

    uint256 public perTxLimit; // USDC base units
    uint64 public coolingOff = 48 hours;

    mapping(bytes32 => uint256) public categoryBudget; // remaining USDC per category
    mapping(address => PayeeState) public payees;
    mapping(bytes32 => bool) public paid; // rule 7: the on-chain paid set
    mapping(uint256 => mapping(uint256 => bool)) public nonceUsed; // agentId => nonce

    event Released(bytes32 indexed invoiceHash, address indexed payee, uint256 amount, bytes32 receiptHash, bool humanSigned);
    event PayeeRegistered(address indexed payee, uint64 eligibleAt);
    event PayeeChallenged(address indexed payee);
    event PayeeCleared(address indexed payee);
    event BudgetSet(bytes32 indexed category, uint256 amount);
    event LimitSet(uint256 perTxLimit);

    /// @param rule The failing release rule (1 to 8).
    /// @param detail Rule-specific context: role or attestation index, or a sub-reason (see `evaluate`).
    error RuleFailed(uint8 rule, uint8 detail);
    error NotExecutor();
    error NotScreener();
    error ZeroAddress();

    constructor(IERC20 usdc_, AgentRegistry registry_, uint256 perTxLimit_) EIP712("CosignPolicy", "1") Ownable(msg.sender) {
        usdc = usdc_;
        registry = registry_;
        perTxLimit = perTxLimit_;
    }

    modifier onlyExecutor() {
        if (msg.sender != executor) revert NotExecutor();
        _;
    }

    modifier onlyScreener() {
        if (msg.sender != screener && msg.sender != owner()) revert NotScreener();
        _;
    }

    // ---- Configuration (owner) ----

    function setExecutor(address executor_) external onlyOwner {
        if (executor_ == address(0)) revert ZeroAddress();
        executor = executor_;
    }

    function setHumanApprover(address approver) external onlyOwner {
        if (approver == address(0)) revert ZeroAddress();
        humanApprover = approver;
    }

    function setScreener(address screener_) external onlyOwner {
        if (screener_ == address(0)) revert ZeroAddress();
        screener = screener_;
    }

    function setPerTxLimit(uint256 limit) external onlyOwner {
        perTxLimit = limit;
        emit LimitSet(limit);
    }

    function setCoolingOff(uint64 seconds_) external onlyOwner {
        coolingOff = seconds_;
    }

    function setBudget(bytes32 category, uint256 amount) external onlyOwner {
        categoryBudget[category] = amount;
        emit BudgetSet(category, amount);
    }

    // ---- Payee allowlist (screener) ----

    /// @notice Allowlist a payee. A brand-new or changed address starts a cooling-off period;
    ///         pass `skipCoolingOff` only for an address the Verifier has long since verified.
    function registerPayee(address payee, bool skipCoolingOff) external onlyScreener {
        if (payee == address(0)) revert ZeroAddress();
        uint64 eligibleAt = skipCoolingOff ? uint64(block.timestamp) : uint64(block.timestamp) + coolingOff;
        payees[payee] = PayeeState(eligibleAt, false);
        emit PayeeRegistered(payee, eligibleAt);
    }

    /// @notice Block a payee: sanctions hit, or an out-of-band challenge is open.
    function challengePayee(address payee) external onlyScreener {
        payees[payee].blocked = true;
        emit PayeeChallenged(payee);
    }

    function clearPayee(address payee) external onlyScreener {
        payees[payee].blocked = false;
        emit PayeeCleared(payee);
    }

    // ---- Release ----

    /// @notice Release USDC for an invoice if, and only if, all eight rules pass. Reverts otherwise.
    /// @param atts Exactly one attestation per required role, in any order.
    /// @param sigs EIP-712 signatures, `sigs[i]` over `atts[i]`.
    /// @param humanSig Approver signature over HumanApproval; required only above the per-tx limit.
    function release(Request calldata req, Attestation[] calldata atts, bytes[] calldata sigs, bytes calldata humanSig)
        external
        onlyExecutor
    {
        (uint8 rule, uint8 detail) = evaluate(req, atts, sigs, humanSig);
        if (rule != 0) revert RuleFailed(rule, detail);

        // Effects before the external transfer.
        paid[req.invoiceHash] = true;
        bool humanSigned = req.amount > perTxLimit;
        categoryBudget[req.category] -= req.amount;

        bytes32 receipt;
        for (uint256 i = 0; i < atts.length; i++) {
            nonceUsed[atts[i].agentId][atts[i].nonce] = true;
            receipt = keccak256(abi.encode(receipt, _digest(atts[i])));
        }

        usdc.safeTransfer(req.payee, req.amount);
        emit Released(req.invoiceHash, req.payee, req.amount, receipt, humanSigned);
    }

    /// @notice Check a release without moving funds. Returns (0, 0) when releasable, otherwise the first
    ///         failing rule and a detail code.
    /// @dev Details: rule 1 = missing role index; rule 2/3/4/8 = attestation index; rule 5 = 0 not allowlisted,
    ///      1 blocked/challenged, 2 cooling-off; rule 6 = 0 human signature missing, 1 invalid or expired,
    ///      2 category budget exceeded; rule 7 = 0 invoice already paid, 1 attestation nonce reused.
    function evaluate(Request calldata req, Attestation[] calldata atts, bytes[] calldata sigs, bytes calldata humanSig)
        public
        view
        returns (uint8 rule, uint8 detail)
    {
        // Rule 1: every required role has exactly one attestation.
        if (atts.length != REQUIRED_ROLES || sigs.length != REQUIRED_ROLES) return (1, 255);
        bool[5] memory seen;
        for (uint256 i = 0; i < REQUIRED_ROLES; i++) {
            seen[uint8(atts[i].role)] = true;
        }
        for (uint8 r = 0; r < REQUIRED_ROLES; r++) {
            if (!seen[r]) return (1, r);
        }

        // Rule 2: signers are registered agents above the reputation and bond thresholds, and signed.
        for (uint256 i = 0; i < REQUIRED_ROLES; i++) {
            Attestation calldata a = atts[i];
            if (!registry.isEligible(a.agentId, a.role)) return (2, uint8(i));
            (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(_digest(a), sigs[i]);
            if (err != ECDSA.RecoverError.NoError || recovered != registry.signerOf(a.agentId)) return (2, uint8(i));
        }

        // Rule 3: all attestations bind to the same invoice, payee and amount as the request.
        for (uint256 i = 0; i < REQUIRED_ROLES; i++) {
            Attestation calldata a = atts[i];
            if (a.invoiceHash != req.invoiceHash || a.payee != req.payee || a.amount != req.amount) return (3, uint8(i));
        }

        // Rule 4: every verdict is PASS. FAIL or ESCALATE holds the payment for a human.
        for (uint256 i = 0; i < REQUIRED_ROLES; i++) {
            if (atts[i].verdict != Verdict.PASS) return (4, uint8(i));
        }

        // Rule 5: payee is allowlisted, not blocked, and finished its cooling-off period.
        PayeeState memory ps = payees[req.payee];
        if (ps.eligibleAt == 0) return (5, 0);
        if (ps.blocked) return (5, 1);
        if (block.timestamp < ps.eligibleAt) return (5, 2);

        // Rule 6: within the per-transaction limit (or human-signed) and within the category budget.
        if (req.amount > perTxLimit) {
            if (humanSig.length == 0) return (6, 0);
            if (!_validHumanApproval(req, humanSig)) return (6, 1);
        }
        if (categoryBudget[req.category] < req.amount) return (6, 2);

        // Rule 7: never paid before, and no attestation nonce is being replayed.
        if (paid[req.invoiceHash]) return (7, 0);
        for (uint256 i = 0; i < REQUIRED_ROLES; i++) {
            if (nonceUsed[atts[i].agentId][atts[i].nonce]) return (7, 1);
        }

        // Rule 8: attestations are fresh.
        for (uint256 i = 0; i < REQUIRED_ROLES; i++) {
            if (atts[i].expiry <= block.timestamp) return (8, uint8(i));
        }

        return (0, 0);
    }

    // ---- Hashing helpers (also used off-chain to build signatures) ----

    function attestationDigest(Attestation calldata a) external view returns (bytes32) {
        return _digest(a);
    }

    function humanApprovalDigest(bytes32 invoiceHash, address payee, uint256 amount, uint64 expiry) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(HUMAN_APPROVAL_TYPEHASH, invoiceHash, payee, amount, expiry)));
    }

    function _digest(Attestation calldata a) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ATTESTATION_TYPEHASH,
                    a.invoiceHash,
                    a.payee,
                    a.amount,
                    uint8(a.role),
                    uint8(a.verdict),
                    a.confidenceBps,
                    a.evidenceHash,
                    a.agentId,
                    a.expiry,
                    a.nonce
                )
            )
        );
    }

    /// @dev The human approval carries its own expiry, packed into the first 8 bytes of the signature
    ///      payload: `humanSig = abi.encodePacked(uint64 expiry, bytes65 signature)`.
    function _validHumanApproval(Request calldata req, bytes calldata humanSig) internal view returns (bool) {
        if (humanSig.length != 8 + 65 || humanApprover == address(0)) return false;
        uint64 expiry = uint64(bytes8(humanSig[:8]));
        if (expiry <= block.timestamp) return false;
        bytes32 digest = humanApprovalDigest(req.invoiceHash, req.payee, req.amount, expiry);
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, humanSig[8:]);
        return err == ECDSA.RecoverError.NoError && recovered == humanApprover;
    }
}
