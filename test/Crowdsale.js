const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Crowdsale", function () {
  const ONE_WEEK = 7 * 24 * 60 * 60;

  async function initialDeployFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner, otherAccount, feeReceiver] = await ethers.getSigners();

    const CustomTokenFactory = await ethers.getContractFactory("CustomToken");
    const customToken = await CustomTokenFactory.deploy();

    const CrowdsaleFactory = await ethers.getContractFactory("Crowdsale");
    const crowdsale = await CrowdsaleFactory.deploy(owner);

    const latestTimestamp = await time.latest();
    const nextBlockTimestamp = latestTimestamp + 10;
    await time.setNextBlockTimestamp(nextBlockTimestamp);

    const startTime = nextBlockTimestamp + 1000;
    const endTime = startTime + ONE_WEEK;
    const tokensToSale = ethers.parseUnits("50000", 8);

    await customToken.approve(crowdsale.getAddress(), tokensToSale);

    await crowdsale.initialize(
      startTime,
      endTime,
      50,
      feeReceiver.address,
      await customToken.getAddress(),
      tokensToSale
    );

    return {
      crowdsale,
      customToken,
      owner,
      otherAccount,
      feeReceiver,
      startTime,
      endTime,
      tokensToSale,
    };
  }

  describe("Buy Token", function () {
    it("Should revert if sale hasn't started", async function () {
      const { crowdsale, otherAccount } = await loadFixture(
        initialDeployFixture
      );

      await expect(
        crowdsale.connect(otherAccount).buyShares(otherAccount.address)
      ).to.be.revertedWithCustomError(crowdsale, "OutOfSalePeriod");
    });

    it("Should revert if sale ended", async function () {
      const { crowdsale, endTime, otherAccount } = await loadFixture(
        initialDeployFixture
      );

      await time.increaseTo(endTime + 1);

      await expect(
        crowdsale.connect(otherAccount).buyShares(otherAccount.address)
      ).to.be.revertedWithCustomError(crowdsale, "OutOfSalePeriod");
    });

    it("Should revert if sale is finished", async function () {
      const { crowdsale, owner, endTime, otherAccount } = await loadFixture(
        initialDeployFixture
      );

      await time.increaseTo(endTime + 1);
      await crowdsale.connect(owner).finalizeSale();

      await expect(
        crowdsale.connect(otherAccount).buyShares(otherAccount.address)
      ).to.be.revertedWithCustomError(crowdsale, "OutOfSalePeriod");
    });

    it("Should revert when sending 0 ETH", async function () {
      const { crowdsale, otherAccount, startTime } = await loadFixture(
        initialDeployFixture
      );

      await time.increaseTo(startTime + 1000);

      await expect(
        crowdsale.connect(otherAccount).buyShares(otherAccount.address)
      ).to.be.revertedWithCustomError(crowdsale, "InputValueTooSmall");
    });

    it("Should revert if trying to buy more tokens than available", async function () {
      const { crowdsale, otherAccount, startTime } = await loadFixture(
        initialDeployFixture
      );

      await time.increaseTo(startTime + 1000);

      const tooMuchEth = ethers.parseEther("1100"); // Would try to buy 55,000 tokens when only 50,000 available

      await expect(
        crowdsale
          .connect(otherAccount)
          .buyShares(otherAccount.address, { value: tooMuchEth })
      ).to.be.revertedWithCustomError(crowdsale, "InsufficientTokens");
    });

    it("Should send ether on success", async function () {
      const { crowdsale, otherAccount, startTime } = await loadFixture(
        initialDeployFixture
      );

      await time.increaseTo(startTime + 10000);

      const amount = ethers.parseEther("0.5");
      await expect(
        crowdsale.connect(otherAccount).buyShares(otherAccount.address, {
          value: amount,
        })
      ).to.changeEtherBalances([otherAccount, crowdsale], [-amount, amount]);
    });

    it("Should update tokensSold counter", async function () {
      const { crowdsale, otherAccount, startTime } = await loadFixture(
        initialDeployFixture
      );

      await time.increaseTo(startTime + 1000);

      const ethAmount = ethers.parseEther("1");
      const expectedTokens = ethers.parseUnits("50", 8); // 1 ETH * 50 rate

      await crowdsale
        .connect(otherAccount)
        .buyShares(otherAccount.address, { value: ethAmount });

      expect(await crowdsale.tokensSold()).to.equal(expectedTokens);
    });

    it("Should correctly calculate and transfer tokens", async function () {
      const { crowdsale, customToken, otherAccount, startTime } =
        await loadFixture(initialDeployFixture);

      await time.increaseTo(startTime + 1000);

      const ethAmount = ethers.parseEther("2");
      const expectedTokens = ethers.parseUnits("100", 8); // 2 ETH * 50 rate

      await expect(
        crowdsale
          .connect(otherAccount)
          .buyShares(otherAccount.address, { value: ethAmount })
      ).to.changeTokenBalances(
        customToken,
        [otherAccount, crowdsale],
        [expectedTokens, -expectedTokens]
      );
    });

    it("Should emit TokensPurchased event on successful purchase", async function () {
      const { crowdsale, otherAccount, startTime } = await loadFixture(
        initialDeployFixture
      );

      await time.increaseTo(startTime + 1000);

      const ethAmount = ethers.parseEther("2");
      const expectedTokens = ethers.parseUnits("100", 8); // 2 ETH * 50 rate

      await expect(
        crowdsale
          .connect(otherAccount)
          .buyShares(otherAccount.address, { value: ethAmount })
      )
        .to.emit(crowdsale, "TokensPurchased")
        .withArgs(
          otherAccount.address, // buyer
          otherAccount.address, // receiver
          ethAmount, // ethAmount
          expectedTokens // tokenAmount
        );
    });
  });

  describe("finalizeSale", function () {
    it("Should revert if sale still active", async function () {
      const { crowdsale, owner, startTime, otherAccount } = await loadFixture(
        initialDeployFixture
      );

      await time.increaseTo(startTime + 10000);

      const amount = ethers.parseEther("0.5");
      await crowdsale
        .connect(otherAccount)
        .buyShares(otherAccount.address, { value: amount });

      await expect(
        crowdsale.connect(owner).finalizeSale()
      ).to.be.revertedWithCustomError(crowdsale, "SaleActive");
    });

    it("Should revert if called by non-owner", async function () {
      const { crowdsale, otherAccount, endTime } = await loadFixture(
        initialDeployFixture
      );

      await time.increaseTo(endTime + 1);

      await expect(
        crowdsale.connect(otherAccount).finalizeSale()
      ).to.be.revertedWithCustomError(crowdsale, "OwnableUnauthorizedAccount");
    });

    it("Should revert if already finished", async function () {
      const { crowdsale, owner, endTime } = await loadFixture(
        initialDeployFixture
      );

      await time.increaseTo(endTime + 1);

      await crowdsale.connect(owner).finalizeSale();

      await expect(
        crowdsale.connect(owner).finalizeSale()
      ).to.be.revertedWithCustomError(crowdsale, "AlreadyFinished");
    });

    it("Should allow finalizing if all tokens are sold before endTime", async function () {
      const { crowdsale, owner, otherAccount, startTime } = await loadFixture(
        initialDeployFixture
      );

      await time.increaseTo(startTime + 1000);

      // Buy all tokens
      const ethAmount = ethers.parseEther("1000"); // Enough ETH to buy all tokens
      await crowdsale
        .connect(otherAccount)
        .buyShares(otherAccount.address, { value: ethAmount });

      // Should be able to finalize even though we haven't reached endTime
      await expect(crowdsale.connect(owner).finalizeSale()).to.not.be.reverted;
    });

    it("Should succesfully finish sale and withdraw profit", async function () {
      const {
        crowdsale,
        owner,
        startTime,
        otherAccount,
        customToken,
        tokensToSale,
        endTime,
      } = await loadFixture(initialDeployFixture);

      await time.increaseTo(startTime + 10000);

      const amount = ethers.parseEther("0.5");
      const tokensToReceive = ethers.parseUnits("25", 8);

      await expect(
        await crowdsale
          .connect(otherAccount)
          .buyShares(otherAccount.address, { value: amount })
      ).to.changeTokenBalances(
        customToken,
        [otherAccount, await crowdsale.getAddress()],
        [tokensToReceive, -tokensToReceive]
      );

      time.increaseTo(endTime + 1);

      await expect(
        crowdsale.connect(owner).finalizeSale()
      ).to.changeTokenBalances(
        customToken,
        [owner, await crowdsale.getAddress()],
        [tokensToSale - tokensToReceive, (tokensToSale - tokensToReceive) * -1n]
      );
    });

    it("Should transfer ETH to feeReceiver on finalize", async function () {
      const {
        crowdsale,
        owner,
        otherAccount,
        feeReceiver,
        startTime,
        endTime,
      } = await loadFixture(initialDeployFixture);

      await time.increaseTo(startTime + 1000);

      // Buy some tokens
      const ethAmount = ethers.parseEther("1");
      await crowdsale
        .connect(otherAccount)
        .buyShares(otherAccount.address, { value: ethAmount });

      await time.increaseTo(endTime + 1);

      // Check that ETH is transferred to feeReceiver
      await expect(
        crowdsale.connect(owner).finalizeSale()
      ).to.changeEtherBalance(feeReceiver, ethAmount);
    });

    it("Should set isFinished to true", async function () {
      const { crowdsale, owner, endTime } = await loadFixture(
        initialDeployFixture
      );

      await time.increaseTo(endTime + 1);

      await crowdsale.connect(owner).finalizeSale();

      expect(await crowdsale.isFinished()).to.be.true;
    });

    it("Should emit SaleFinalized event on successful finalization", async function () {
      const { crowdsale, owner, otherAccount, startTime, endTime } =
        await loadFixture(initialDeployFixture);

      await time.increaseTo(startTime + 1000);

      // Buy some tokens
      const ethAmount = ethers.parseEther("2");
      await crowdsale
        .connect(otherAccount)
        .buyShares(otherAccount.address, { value: ethAmount });

      await time.increaseTo(endTime + 1);

      // Get expected values for the event
      const tokensSold = await crowdsale.tokensSold();
      const ethRaised = await ethers.provider.getBalance(
        crowdsale.getAddress()
      );
      const remainingTokens = (await crowdsale.tokensForSale()) - tokensSold;

      await expect(crowdsale.connect(owner).finalizeSale())
        .to.emit(crowdsale, "SaleFinalized")
        .withArgs(tokensSold, ethRaised, remainingTokens);
    });
  });
});
