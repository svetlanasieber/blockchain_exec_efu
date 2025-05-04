const { task } = require("hardhat/config");

task("deploy", "Deploys CustomToken and Crowdsale contracts")
  .addParam("startOffset", "Sale start time offset in seconds from now", "1000")
  .addParam(
    "duration",
    "Sale duration in seconds",
    (7 * 24 * 60 * 60).toString()
  )
  .addParam("price", "Token price (tokens per ETH)", "50")
  .addParam("tokensForSale", "Amount of tokens for sale", "50000")
  .addParam("feeReceiver", "Address that receives fees", "") // Will default to deployer if empty
  .setAction(async (taskArgs, hre) => {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);

    const startOffset = parseInt(taskArgs.startOffset);
    const duration = parseInt(taskArgs.duration);
    const price = parseInt(taskArgs.price);
    const tokensForSale = hre.ethers.parseUnits(taskArgs.tokensForSale, 8);
    const feeReceiver = taskArgs.feeReceiver || deployer.address;

   
    const CustomToken = await hre.ethers.getContractFactory("CustomToken");
    const customToken = await CustomToken.deploy();
    await customToken.waitForDeployment();
    console.log("CustomToken deployed to:", await customToken.getAddress());

  
    const Crowdsale = await hre.ethers.getContractFactory("Crowdsale");
    const crowdsale = await Crowdsale.deploy(deployer.address);
    await crowdsale.waitForDeployment();
    console.log("Crowdsale deployed to:", await crowdsale.getAddress());

   
    const latestBlock = await hre.ethers.provider.getBlock("latest");
    const startTime = latestBlock.timestamp + startOffset;
    const endTime = startTime + duration;

    
    await customToken.approve(await crowdsale.getAddress(), tokensForSale);
    console.log("Approved tokens for Crowdsale");

  
    await crowdsale.initialize(
      startTime,
      endTime,
      price,
      feeReceiver,
      await customToken.getAddress(),
      tokensForSale
    );
    console.log("Initialized Crowdsale");

    
    if (hre.network.name === "sepolia") {
      console.log("\nVerifying contracts on Sepolia...");

   
      console.log("Waiting for block confirmations...");
      await customToken.deploymentTransaction().wait();
      await crowdsale.deploymentTransaction().wait();

      
      try {
        await hre.run("verify:verify", {
          address: await customToken.getAddress(),
          constructorArguments: [],
        });
        console.log("CustomToken verified successfully");
      } catch (error) {
        console.log("CustomToken verification failed:", error.message);
      }

      
      try {
        await hre.run("verify:verify", {
          address: await crowdsale.getAddress(),
          constructorArguments: [deployer.address],
        });
        console.log("Crowdsale verified successfully");
      } catch (error) {
        console.log("Crowdsale verification failed:", error.message);
      }
    }

    console.log("\nDeployment Summary:");
    console.log("-------------------");
    console.log("CustomToken:", await customToken.getAddress());
    console.log("Crowdsale:", await crowdsale.getAddress());
    console.log("Start Time:", new Date(startTime * 1000).toLocaleString());
    console.log("End Time:", new Date(endTime * 1000).toLocaleString());
    console.log("Price:", price, "tokens per ETH");
    console.log("Tokens for Sale:", hre.ethers.formatUnits(tokensForSale, 8));
    console.log("Fee Receiver:", feeReceiver);
  });

task("buy", "Buy tokens from the Crowdsale contract")
  .addParam("crowdsale", "Address of the Crowdsale contract")
  .addParam("amount", "Amount of ETH to spend")
  .addOptionalParam("receiver", "Address to receive tokens", "") // Will default to sender if empty
  .setAction(async (taskArgs, hre) => {
    const [signer] = await hre.ethers.getSigners();
    console.log("Buying tokens with account:", signer.address);

  
    const crowdsaleAddress = taskArgs.crowdsale;
    const ethAmount = hre.ethers.parseEther(taskArgs.amount);
    const receiver = taskArgs.receiver || signer.address;

   
    const Crowdsale = await hre.ethers.getContractFactory("Crowdsale");
    const crowdsale = Crowdsale.attach(crowdsaleAddress);

    
    const tokenAddress = await crowdsale.token();
    const CustomToken = await hre.ethers.getContractFactory("CustomToken");
    const token = CustomToken.attach(tokenAddress);

 
    const initialTokenBalance = await token.balanceOf(receiver);
    const initialEthBalance = await hre.ethers.provider.getBalance(receiver);

    console.log("\nTransaction Details:");
    console.log("-------------------");
    console.log("Crowdsale Address:", crowdsaleAddress);
    console.log("Token Address:", tokenAddress);
    console.log("ETH Amount:", hre.ethers.formatEther(ethAmount), "ETH");
    console.log("Receiver:", receiver);
    console.log(
      "Initial Token Balance:",
      hre.ethers.formatUnits(initialTokenBalance, 8)
    );

   
    console.log("\nExecuting purchase...");
    const tx = await crowdsale.buyShares(receiver, { value: ethAmount });
    await tx.wait();

  
    const finalTokenBalance = await token.balanceOf(receiver);
    const finalEthBalance = await hre.ethers.provider.getBalance(receiver);

   
    const tokenChange = finalTokenBalance - initialTokenBalance;
    const ethChange = finalEthBalance - initialEthBalance;

    console.log("\nPurchase Summary:");
    console.log("----------------");
    console.log("Tokens Received:", hre.ethers.formatUnits(tokenChange, 8));
    console.log("ETH Spent:", hre.ethers.formatEther(ethChange * -1n), "ETH");
    console.log(
      "New Token Balance:",
      hre.ethers.formatUnits(finalTokenBalance, 8)
    );

    const tokensSold = await crowdsale.tokensSold();
    const tokensForSale = await crowdsale.tokensForSale();

    console.log("\nSale Status:");
    console.log("------------");
    console.log("Tokens Sold:", hre.ethers.formatUnits(tokensSold, 8));
    console.log(
      "Tokens Remaining:",
      hre.ethers.formatUnits(tokensForSale - tokensSold, 8)
    );
    console.log(
      "Sale Progress:",
      ((Number(tokensSold) * 100) / Number(tokensForSale)).toFixed(2),
      "%"
    );
  });
