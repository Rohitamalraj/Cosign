// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Test-only CCTP V2 TokenMessenger: pulls the USDC (a real one burns it) and records the call.
contract MockTokenMessenger {
    struct Burn {
        uint256 amount;
        uint32 destinationDomain;
        bytes32 mintRecipient;
        address burnToken;
        bytes32 destinationCaller;
        uint256 maxFee;
        uint32 minFinalityThreshold;
    }

    Burn[] public burns;
    bool public failNext;

    event DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain);

    function setFailNext(bool v) external {
        failNext = v;
    }

    function burnCount() external view returns (uint256) {
        return burns.length;
    }

    function depositForBurn(uint256 amount, uint32 domain, bytes32 recipient, address token, bytes32 caller, uint256 maxFee, uint32 finality) external {
        require(!failNext, "fee required");
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "pull");
        burns.push(Burn(amount, domain, recipient, token, caller, maxFee, finality));
        emit DepositForBurn(token, amount, msg.sender, recipient, domain);
    }
}
