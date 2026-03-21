import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();

  console.log("Deploying DigitalWill contract...");

  const contract = await ethers.deployContract("DigitalWill");

  console.log("Waiting for deployment confirmation...");
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`\n✅ DigitalWill deployed successfully!`);
  console.log(`📋 Contract Address: ${address}`);
  console.log(`\n🔗 View on Sepolia Etherscan: https://sepolia.etherscan.io/address/${address}`);
  console.log(`\n⚙️  Set in your backend .env:`);
  console.log(`DIGITAL_WILL_CONTRACT_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});