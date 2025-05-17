#!/usr/bin/env node
import fs from "fs";
import readline from "readline";
import { ethers } from "ethers";
import fetch from "node-fetch";
import solc from "solc";
import { randomBytes } from "crypto";

// === CONFIG ===
const CONFIG = {
  CHAIN_ID: 16601,
  RPC_URL: "https://evmrpc-testnet.0g.ai",
  NETWORK_NAME: "0G-Galileo-Testnet",
  CURRENCY_SYMBOL: "OG",
  TOKENS: {
    USDT: "0x3eC8A8705bE1D5ca90066b37ba62c4183B024ebf",
    BTC: "0x36f6414FF1df609214dDAbA71c84f18bcf00F67d",
    ETH: "0x0fE9B43625fA7EdD663aDcEC0728DD635e4AbF7c",
  },
  UNISWAP_ROUTER: "0xb95B5953FF8ee5D5d9818CdbEfE363ff2191318c",
};

const ROUTER_ABI = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) external payable returns (uint256)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

const TOKEN_DECIMALS = { USDT: 18, BTC: 18, ETH: 18 };
const PAIRS = [
  ["USDT", "BTC"],
  ["USDT", "ETH"],
  ["BTC", "USDT"],
  ["ETH", "USDT"],
];

// === GAS PRICE FETCH ===
async function fetchGasPrice() {
  try {
    const response = await fetch(
      "https://chainscan-galileo.0g.ai/stat/gasprice/tracker"
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    if (
      data.result &&
      data.result.gasPriceMarket &&
      data.result.gasPriceMarket.tp50
    ) {
      const gasPrice = BigInt(data.result.gasPriceMarket.tp50);
      console.log(
        `🔍 Fetched gas price: ${ethers.formatUnits(gasPrice, "gwei")} gwei`
      );
      return gasPrice;
    }
    throw new Error("Invalid gas price data structure");
  } catch (error) {
    console.warn("⚠️ Failed to fetch gas price, using fallback:", error.message);
    const fallbackPrice = BigInt(3e9); // 3 gwei
    console.log(`🔍 Using fallback gas price: ${ethers.formatUnits(fallbackPrice, "gwei")} gwei`);
    return fallbackPrice;
  }
}

// === UTILITIES ===
function getRandomFloat(min, max, decimals = 6) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function wait(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function generateRandomName(length = 12) {
  return Array.from({ length }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26))
  ).join("");
}

// === SWAP LOGIC ===
async function autoSwap(privateKeys, delay) {
  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);

  for (const [i, pk] of privateKeys.entries()) {
    const wallet = new ethers.Wallet(pk.trim(), provider);
    console.log(`\n🧾 [${i + 1}/${privateKeys.length}] Wallet: ${wallet.address}`);
    const router = new ethers.Contract(CONFIG.UNISWAP_ROUTER, ROUTER_ABI, wallet);

    for (let j = 0; j < 10;) {
      const [fromSym, toSym] = PAIRS[Math.floor(Math.random() * PAIRS.length)];
      const amount =
        fromSym === "USDT"
          ? getRandomFloat(100, 1111)
          : fromSym === "ETH"
          ? getRandomFloat(0.01, 0.12)
          : getRandomFloat(0.0005, 0.0051);

      const tokenInAddr = CONFIG.TOKENS[fromSym];
      const tokenOutAddr = CONFIG.TOKENS[toSym];
      const tokenIn = new ethers.Contract(tokenInAddr, ERC20_ABI, wallet);
      const decimals = TOKEN_DECIMALS[fromSym];
      const amountIn = ethers.parseUnits(amount.toString(), decimals);

      const gasPrice = await fetchGasPrice();

      const allowance = await tokenIn.allowance(wallet.address, CONFIG.UNISWAP_ROUTER);
      const balance = await tokenIn.balanceOf(wallet.address);
      console.log(`💰 Balance ${fromSym}: ${ethers.formatUnits(balance, decimals)} | Need: ${amount}`);
      if (allowance < amountIn) {
        await tokenIn.approve(CONFIG.UNISWAP_ROUTER, amountIn);
        console.log(`✅ Approved ${fromSym} for swap.`);
      }

      try {
        const tx = await router.exactInputSingle(
          [
            tokenInAddr,
            tokenOutAddr,
            3000,
            wallet.address,
            Math.floor(Date.now() / 1000) + 60,
            amountIn,
            0,
            0,
          ],
          { gasPrice }
        );
        console.log(
          `🔁 Swapping ${amount} ${fromSym} → ${toSym} | tx: ${tx.hash}`
        );
        await tx.wait();
        console.log(`✅ Swap ${j + 1}/10 completed.`);
        j++; // chỉ tăng khi swap thành công
      } catch (e) {
        console.log(`❌ Swap failed: ${e.message}`);
        console.log(`🔁 Đang thử lại swap...`);
        await wait(getRandomFloat(8_000, 15_000)); // đợi một chút trước khi thử lại
        continue;
      }

      const swapWait = getRandomFloat(35_000, 120_000);
      console.log(`⏳ Waiting ${swapWait / 1000}s before next swap...`);
      await wait(swapWait);
    }

    const walletDelay = getRandomFloat(delay + 30, delay + 40) * 1000;
    console.log(`🛌 Done with wallet, waiting ${walletDelay / 1000}s...`);
    await wait(walletDelay);
  }
}


// === CONTRACT SOURCE ===
const TOKEN_CONTRACT_SOURCE = `
pragma solidity ^0.8.0;
contract Token {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
        totalSupply = 1000000 * 10 ** uint256(decimals);
        balanceOf[msg.sender] = totalSupply;
    }
}
`;

function compileTokenContract() {
  const input = {
    language: "Solidity",
    sources: {
      "Token.sol": {
        content: TOKEN_CONTRACT_SOURCE,
      },
    },
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const contract = output.contracts["Token.sol"]["Token"];
  return {
    abi: contract.abi,
    bytecode: "0x" + contract.evm.bytecode.object,
  };
}

// === DEPLOY LOGIC ===
async function autoDeploy(privateKeys) {
  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  const { abi, bytecode } = compileTokenContract(); // 🔥 Biên dịch trực tiếp

  for (const [i, pk] of privateKeys.entries()) {
    const wallet = new ethers.Wallet(pk.trim(), provider);
    const name = generateRandomName();
    const symbol = generateRandomName(4);

    const gasPrice = await fetchGasPrice();

    const factory = new ethers.ContractFactory(abi, bytecode, wallet);

    try {
      const contract = await factory.deploy(name, symbol, { gasPrice });
      console.log(`🚀 Deploying token [${name} | ${symbol}]... tx: ${contract.deploymentTransaction().hash}`);
      await contract.waitForDeployment();
      console.log(`✅ Deployed at ${await contract.getAddress()}`);
    } catch (e) {
      console.log(`❌ Deploy failed: ${e.message}`);
    }

    const deployDelay = getRandomFloat(62_000, 125_000);
    console.log(`🕒 Waiting ${deployDelay / 1000}s before next wallet...`);
    await wait(deployDelay);
  }
}

// === MAIN ===
(async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  function ask(query) {
    return new Promise((res) => rl.question(query, res));
  }

  let option;
  while (option !== "1" && option !== "2") {
    option = await ask("🔧 Chọn chức năng:\n1. Auto Swap\n2. Auto Deploy\n👉 Nhập (1 hoặc 2): ");
  }

  const privateKeys = fs.readFileSync("private_key.txt", "utf8").split("\n").filter(Boolean);
  if (option === "1") {
    let delay;
    do {
      delay = await ask("⏲️ Nhập thời gian delay giữa các ví (giây): ");
    } while (isNaN(delay) || delay < 0);
    rl.close();
    await autoSwap(privateKeys, parseInt(delay));
  } else {
    rl.close();
    await autoDeploy(privateKeys);
  }
})();

