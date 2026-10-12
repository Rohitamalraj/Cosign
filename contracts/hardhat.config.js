require('@nomicfoundation/hardhat-toolbox');

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.24',
    // paris: no PUSH0/MCOPY, so it deploys on chains that lag the latest EVM (Arc support not yet confirmed).
    settings: { evmVersion: 'paris', optimizer: { enabled: true, runs: 200 }, viaIR: true },
  },
};
