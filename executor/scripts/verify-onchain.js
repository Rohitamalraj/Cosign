// Independent check of deployments/onchain-demo.json straight from the Arc testnet RPC. Needs no keys.
const { JsonRpcProvider, Contract, Interface, formatUnits } = require('ethers');
const demo = require('../../deployments/onchain-demo.json');
const dep = require('../../deployments/arc-testnet.json');

(async () => {
  const p = new JsonRpcProvider('https://rpc.testnet.arc.io');
  const iface = new Interface(['event Released(bytes32 indexed invoiceHash,address indexed payee,uint256 amount,bytes32 receiptHash,bool humanSigned)']);
  const usdc = new Contract(dep.usdc, ['function balanceOf(address) view returns (uint256)'], p);
  const policy = new Contract(dep.policy, ['function paid(bytes32) view returns (bool)'], p);
  let ok = true;
  for (const c of demo.cases) {
    const paid = await policy.paid(c.invoiceHash);
    if (c.txHash && c.executor !== 'HELD') {
      const r = await p.getTransactionReceipt(c.txHash);
      const ev = r.logs.filter((l) => l.address.toLowerCase() === dep.policy.toLowerCase()).map((l) => { try { return iface.parseLog(l); } catch { return null; } }).find((e) => e?.name === 'Released');
      const bal = Number(formatUnits(await usdc.balanceOf(c.payee), 6));
      const good = r.status === 1 && ev && ev.args.invoiceHash === c.invoiceHash && paid && bal >= c.amountUsdc;
      ok = ok && !!good;
      console.log(`Case ${c.case}: tx ${r.status === 1 ? 'success' : 'FAILED'} in block ${r.blockNumber}, Released event for ${formatUnits(ev.args.amount, 6)} USDC, humanSigned=${ev.args.humanSigned}, in paid set=${paid}, payee holds ${bal} USDC -> ${good ? 'VERIFIED' : 'MISMATCH'}`);
    } else {
      const good = !paid;
      ok = ok && good;
      console.log(`Case ${c.case}: held (${c.reason?.split(':')[0] ?? 'held'}); in paid set=${paid} -> ${good ? 'VERIFIED nothing paid' : 'MISMATCH'}`);
    }
  }
  console.log(ok ? '\nALL VERIFIED from chain state' : '\nSOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
