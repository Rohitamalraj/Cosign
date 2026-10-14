// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Test-only USYC share token (6 decimals), mintable and burnable by the mock Teller.
contract MockUsyc is ERC20 {
    address public teller;

    constructor() ERC20("Mock USYC", "USYC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function setTeller(address teller_) external {
        require(teller == address(0), "set");
        teller = teller_;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == teller, "teller");
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(msg.sender == teller, "teller");
        _burn(from, amount);
    }
}

/// @notice Test-only Teller with the same two calls as Circle's. `price` is USDC per share scaled by 1e6, so tests can
///         model yield; shares are minted at the current price. It pays redemptions out of its own USDC balance.
///         Unlike a real Teller it does not enforce any entitlement.
contract MockUsycTeller {
    IERC20 public immutable usdc;
    MockUsyc public immutable usyc;
    uint256 public price = 1e6;

    constructor(IERC20 usdc_, MockUsyc usyc_) {
        usdc = usdc_;
        usyc = usyc_;
    }

    function setPrice(uint256 price_) external {
        price = price_;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        shares = (assets * 1e6) / price;
        require(usdc.transferFrom(msg.sender, address(this), assets), "pull");
        usyc.mint(receiver, shares);
    }

    function redeem(uint256 shares, address receiver, address account) external returns (uint256 assets) {
        require(account == msg.sender, "account");
        assets = (shares * price) / 1e6;
        usyc.burn(account, shares);
        require(usdc.transfer(receiver, assets), "pay");
    }
}
