import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { POLICY_ABI } from './abi';

export * from './abi';
export * from './executor';
export * from './explain';
export * from './human';
export * from './receipt';
export * from './server';
export * from './store';
export * from './types';

/** Connect the policy contract with the Executor's own key. This wallet should hold gas and nothing else. */
export function connectPolicy(args: { rpcUrl: string; policyAddress: string; privateKey: string }): Contract {
  const wallet = new Wallet(args.privateKey, new JsonRpcProvider(args.rpcUrl));
  return new Contract(args.policyAddress, POLICY_ABI, wallet);
}
