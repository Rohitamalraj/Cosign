// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice The five roles whose signed attestations the policy contract requires.
enum Role {
    READER,
    VERIFIER,
    MATCHER,
    SENTINEL,
    TREASURER
}

/// @title AgentRegistry
/// @notice Minimal identity + reputation + bond registry, modelled on the ERC-8004 Identity and
///         Reputation registries (a draft standard). Swap for the real registries if they exist on Arc.
/// @dev Scores change ONLY through `recordOutcome`, callable ONLY by the Auditor. There is no
///      agent-to-agent rating path by design.
contract AgentRegistry is Ownable {
    using SafeERC20 for IERC20;

    struct Agent {
        address operator; // posts the bond, can top it up
        address signer; // key that signs this agent's EIP-712 attestations
        Role role;
        uint128 bond; // USDC base units
        int32 score; // 0..100, per role
        bool active;
    }

    int32 public constant MAX_SCORE = 100;

    IERC20 public immutable usdc;
    address public auditor;
    address public recoveryPool;

    // Configuration values, not constants: initial numbers are demo assumptions.
    int32 public initialScore = 50;
    int32 public minScore = 40;
    uint128 public minBond = 100e6;

    uint256 public nextAgentId = 1;
    mapping(uint256 => Agent) private _agents;

    event AgentRegistered(uint256 indexed agentId, address indexed operator, address signer, Role role, uint128 bond);
    event BondToppedUp(uint256 indexed agentId, uint128 amount, uint128 newBond);
    event OutcomeRecorded(uint256 indexed agentId, int32 scoreDelta, int32 newScore, uint128 slashed, uint128 newBond);
    event AgentDeactivated(uint256 indexed agentId);
    event ConfigUpdated(int32 initialScore, int32 minScore, uint128 minBond);

    error NotAuditor();
    error NotOperator();
    error ZeroAddress();
    error UnknownAgent();
    error BondTooLow();

    constructor(IERC20 usdc_, address recoveryPool_) Ownable(msg.sender) {
        if (address(usdc_) == address(0) || recoveryPool_ == address(0)) revert ZeroAddress();
        usdc = usdc_;
        recoveryPool = recoveryPool_;
    }

    modifier onlyAuditor() {
        if (msg.sender != auditor) revert NotAuditor();
        _;
    }

    // ---- Admin ----

    function setAuditor(address auditor_) external onlyOwner {
        if (auditor_ == address(0)) revert ZeroAddress();
        auditor = auditor_;
    }

    function setRecoveryPool(address pool) external onlyOwner {
        if (pool == address(0)) revert ZeroAddress();
        recoveryPool = pool;
    }

    function setConfig(int32 initialScore_, int32 minScore_, uint128 minBond_) external onlyOwner {
        initialScore = initialScore_;
        minScore = minScore_;
        minBond = minBond_;
        emit ConfigUpdated(initialScore_, minScore_, minBond_);
    }

    // ---- Agents ----

    /// @notice Register an agent and post its USDC bond. Caller must have approved `bondAmount`.
    function register(Role role, address signer, uint128 bondAmount) external returns (uint256 agentId) {
        if (signer == address(0)) revert ZeroAddress();
        if (bondAmount < minBond) revert BondTooLow();
        usdc.safeTransferFrom(msg.sender, address(this), bondAmount);

        agentId = nextAgentId++;
        _agents[agentId] = Agent(msg.sender, signer, role, bondAmount, initialScore, true);
        emit AgentRegistered(agentId, msg.sender, signer, role, bondAmount);
    }

    function topUpBond(uint256 agentId, uint128 amount) external {
        Agent storage a = _agents[agentId];
        if (a.operator == address(0)) revert UnknownAgent();
        if (msg.sender != a.operator) revert NotOperator();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        a.bond += amount;
        emit BondToppedUp(agentId, amount, a.bond);
    }

    function deactivate(uint256 agentId) external {
        Agent storage a = _agents[agentId];
        if (a.operator == address(0)) revert UnknownAgent();
        if (msg.sender != a.operator && msg.sender != owner()) revert NotOperator();
        a.active = false;
        emit AgentDeactivated(agentId);
    }

    /// @notice Auditor writes an outcome: a score change and, for a proven bad approval, a bond slash
    ///         paid into the business's loss-recovery pool.
    function recordOutcome(uint256 agentId, int32 scoreDelta, uint128 slashAmount) external onlyAuditor {
        Agent storage a = _agents[agentId];
        if (a.operator == address(0)) revert UnknownAgent();

        int32 next = a.score + scoreDelta;
        if (next < 0) next = 0;
        if (next > MAX_SCORE) next = MAX_SCORE;
        a.score = next;

        uint128 slashed = slashAmount > a.bond ? a.bond : slashAmount;
        if (slashed > 0) {
            a.bond -= slashed;
            usdc.safeTransfer(recoveryPool, slashed);
        }
        emit OutcomeRecorded(agentId, scoreDelta, next, slashed, a.bond);
    }

    // ---- Views ----

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        return _agents[agentId];
    }

    function signerOf(uint256 agentId) external view returns (address) {
        return _agents[agentId].signer;
    }

    /// @notice True when the agent exists, is active, holds `role`, and is above the score and bond thresholds.
    function isEligible(uint256 agentId, Role role) external view returns (bool) {
        Agent storage a = _agents[agentId];
        return a.operator != address(0) && a.active && a.role == role && a.score >= minScore && a.bond >= minBond;
    }
}
