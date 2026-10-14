// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AgentRegistry, Role} from "./AgentRegistry.sol";

/// @notice The subset of Circle's USYC Teller this contract uses.
interface IUsycTeller {
    /// @return shares USYC minted to `receiver` for `assets` USDC.
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    /// @return assets USDC sent to `receiver` for `shares` USYC held by `account`.
    function redeem(uint256 shares, address receiver, address account) external returns (uint256 assets);
}

/// @title CosignTreasury
/// @notice Holds an idle USDC reserve and, only on a signed order from the Treasurer agent, parks part of it in
///         USYC (Circle's tokenized money-market fund) and takes it back out. It is the ONLY address that talks to
///         the Teller, which is also the only address that needs a Circle entitlement.
/// @dev Safety properties, all enforced here and not by the agent:
///      - an order must be signed by the registered, eligible Treasurer agent (same registry the policy uses);
///      - redeemed USDC can only go to `payoutPolicy` (the contract that pays invoices), never to an arbitrary address;
///      - invested principal never exceeds `maxInvestBps` of the reserve, and `operatingFloor` USDC always stays liquid;
///      - orders expire and carry a nonce, so they cannot be replayed.
///      Trust note: the owner can still withdraw idle USDC with `withdrawUsdc` (a testnet convenience), but cannot
///      move USYC anywhere except back through `redeem` to the policy.
contract CosignTreasury is EIP712, Ownable {
    using SafeERC20 for IERC20;

    enum Action {
        INVEST,
        REDEEM
    }

    /// @dev `amount` is USDC for INVEST and USYC shares for REDEEM (both 6 decimals).
    struct TreasuryOrder {
        Action action;
        uint256 amount;
        uint256 agentId;
        uint64 expiry;
        uint256 nonce;
    }

    bytes32 public constant ORDER_TYPEHASH =
        keccak256("TreasuryOrder(uint8 action,uint256 amount,uint256 agentId,uint64 expiry,uint256 nonce)");

    IERC20 public immutable usdc;
    IERC20 public immutable usyc;
    IUsycTeller public immutable teller;
    AgentRegistry public immutable registry;

    address public operator; // the Executor: submits signed orders
    address public payoutPolicy; // the only destination for redeemed USDC

    uint16 public maxInvestBps = 7_000; // at most 70% of the reserve may sit in USYC
    uint256 public operatingFloor; // USDC that must always stay liquid in this contract
    uint256 public investedPrincipal; // USDC cost basis currently parked in USYC

    mapping(uint256 => mapping(uint256 => bool)) public nonceUsed; // agentId => nonce

    event Invested(uint256 indexed agentId, uint256 usdcIn, uint256 usycOut, uint256 investedPrincipal);
    event Redeemed(uint256 indexed agentId, uint256 usycIn, uint256 usdcOut, address indexed to, uint256 investedPrincipal);
    event Deposited(address indexed from, uint256 amount);
    event ConfigSet(uint16 maxInvestBps, uint256 operatingFloor);

    error NotOperator();
    error ZeroAddress();
    error BadSignature();
    error NotTreasurer();
    error Expired();
    error NonceReused();
    error ExceedsInvestCap();
    error BelowOperatingFloor();
    error InvalidBps();

    constructor(IERC20 usdc_, IERC20 usyc_, IUsycTeller teller_, AgentRegistry registry_)
        EIP712("CosignTreasury", "1")
        Ownable(msg.sender)
    {
        if (address(usdc_) == address(0) || address(usyc_) == address(0) || address(teller_) == address(0)) revert ZeroAddress();
        usdc = usdc_;
        usyc = usyc_;
        teller = teller_;
        registry = registry_;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    // ---- Configuration (owner) ----

    function setOperator(address operator_) external onlyOwner {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
    }

    function setPayoutPolicy(address policy_) external onlyOwner {
        if (policy_ == address(0)) revert ZeroAddress();
        payoutPolicy = policy_;
    }

    function setLimits(uint16 maxInvestBps_, uint256 operatingFloor_) external onlyOwner {
        if (maxInvestBps_ > 10_000) revert InvalidBps();
        maxInvestBps = maxInvestBps_;
        operatingFloor = operatingFloor_;
        emit ConfigSet(maxInvestBps_, operatingFloor_);
    }

    /// @notice Anyone can add USDC to the reserve.
    function deposit(uint256 amount) external {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Testnet convenience: the owner can take back idle USDC (never USYC).
    function withdrawUsdc(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        usdc.safeTransfer(to, amount);
    }

    // ---- Treasurer orders ----

    /// @notice Subscribe `order.amount` USDC to USYC. Reverts if it would exceed the invest cap or breach the floor.
    function invest(TreasuryOrder calldata order, bytes calldata sig) external onlyOperator returns (uint256 shares) {
        _consume(order, sig, Action.INVEST);

        uint256 liquid = usdc.balanceOf(address(this));
        uint256 total = liquid + investedPrincipal; // total under management, at cost
        if (investedPrincipal + order.amount > (total * maxInvestBps) / 10_000) revert ExceedsInvestCap();
        if (liquid < order.amount || liquid - order.amount < operatingFloor) revert BelowOperatingFloor();

        investedPrincipal += order.amount;
        usdc.forceApprove(address(teller), order.amount);
        shares = teller.deposit(order.amount, address(this));
        emit Invested(order.agentId, order.amount, shares, investedPrincipal);
    }

    /// @notice Redeem `order.amount` USYC shares; the USDC goes to the policy contract and nowhere else.
    function redeem(TreasuryOrder calldata order, bytes calldata sig) external onlyOperator returns (uint256 assets) {
        _consume(order, sig, Action.REDEEM);
        address to = payoutPolicy;
        if (to == address(0)) revert ZeroAddress();

        usyc.forceApprove(address(teller), order.amount);
        assets = teller.redeem(order.amount, to, address(this));

        // Cost basis falls by what was redeemed, never below zero; any gain above cost has gone to the policy.
        investedPrincipal = assets >= investedPrincipal ? 0 : investedPrincipal - assets;
        emit Redeemed(order.agentId, order.amount, assets, to, investedPrincipal);
    }

    // ---- Views and hashing (also used off-chain to build signatures) ----

    function orderDigest(TreasuryOrder calldata order) external view returns (bytes32) {
        return _digest(order);
    }

    /// @notice Total under management at cost: liquid USDC plus principal parked in USYC.
    function reserve() external view returns (uint256) {
        return usdc.balanceOf(address(this)) + investedPrincipal;
    }

    function _consume(TreasuryOrder calldata order, bytes calldata sig, Action expected) internal {
        if (order.action != expected) revert BadSignature();
        if (order.expiry <= block.timestamp) revert Expired();
        if (!registry.isEligible(order.agentId, Role.TREASURER)) revert NotTreasurer();
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(_digest(order), sig);
        if (err != ECDSA.RecoverError.NoError || recovered != registry.signerOf(order.agentId)) revert BadSignature();
        if (nonceUsed[order.agentId][order.nonce]) revert NonceReused();
        nonceUsed[order.agentId][order.nonce] = true;
    }

    function _digest(TreasuryOrder calldata o) internal view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ORDER_TYPEHASH, uint8(o.action), o.amount, o.agentId, o.expiry, o.nonce)));
    }
}
