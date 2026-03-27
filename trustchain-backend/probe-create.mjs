import { config } from 'dotenv';
import { ethers } from 'ethers';

config();

const rpc = process.env.BLOCKCHAIN_RPC_URL;
const pk = process.env.DIGITAL_WILL_OWNER_PRIVATE_KEY;
const addr = process.env.DIGITAL_WILL_CONTRACT_ADDRESS;

const abi = [
  'function backendSigner() view returns (address)',
  'function createWill((string willId,address primaryBeneficiary,string metadataCid,uint256 releaseTime,bool requiresDeath,uint256 minAge,uint256 ownerDOB) p)',
  'function fundWill(string _willId) payable',
  'function wills(string) view returns (address owner,string primaryBeneficiary,string metadataCid,bool requiresDeath,bool requiresAge,bool deathVerified,uint256 releaseTime,uint256 minAge,uint256 ownerDOB,bool executed,bool revoked,uint256 fundedAmountWei,uint256 beneficiaryCount,uint256 createdAt)'
];

const provider = new ethers.JsonRpcProvider(rpc);
const wallet = new ethers.Wallet(pk, provider);
const c = new ethers.Contract(addr, abi, wallet);

const id = `WILL-PROBE-${Date.now()}`;
const p = {
  willId: id,
  primaryBeneficiary: '0x8476f015ca3A7e8F5075806128305B31b3470641',
  metadataCid: 'bafkreiTEST',
  releaseTime: Math.floor(Date.now() / 1000) + 86400,
  requiresDeath: false,
  minAge: 0,
  ownerDOB: 0
};

(async () => {
  try {
    console.log('wallet', wallet.address);
    console.log('backendSigner', await c.backendSigner());
    const gas = await c.createWill.estimateGas(p);
    console.log('estimateGas createWill', gas.toString());
    const tx = await c.createWill(p, { gasLimit: 400000 });
    console.log('create tx', tx.hash);
    await tx.wait();
    console.log('create ok');

    const fgas = await c.fundWill.estimateGas(id, { value: ethers.parseEther('0.0003') });
    console.log('estimateGas fund', fgas.toString());
    const ftx = await c.fundWill(id, { value: ethers.parseEther('0.0003'), gasLimit: 200000 });
    console.log('fund tx', ftx.hash);
    await ftx.wait();
    console.log('fund ok');
  } catch (e) {
    console.log('ERR short', e.shortMessage);
    console.log('ERR reason', e.reason);
    console.log('ERR msg', e.message);
    console.log('ERR data', e.data);
  }
})();
