require('@nomicfoundation/hardhat-toolbox');

// Load contracts/.env (gitignored) if present. Never commit keys.
try { process.loadEnvFile('.env'); } catch { /* no .env: local tests only */ }

const accounts = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.24',
    // paris is older than Arc's Osaka baseline, so the bytecode is valid there (deployed and verified on Arc testnet).
    settings: { evmVersion: 'paris', optimizer: { enabled: true, runs: 200 }, viaIR: true },
  },
  networks: {
    // Arc testnet: chain 5042002, gas is paid in USDC, maxFeePerGas must be >= 20 gwei or the mempool drops the tx.
    arcTestnet: {
      url: process.env.ARC_TESTNET_RPC_URL ?? 'https://rpc.testnet.arc.io',
      chainId: 5042002,
      accounts,
    },
  },
};
