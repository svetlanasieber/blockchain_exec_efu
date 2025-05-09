// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ICustomToken} from "./ICustomToken.sol";

contract Crowdsale is Ownable {
    uint256 public constant MIN_SALE_PERIOD = 1 weeks;

    address public token;
    uint256 public price;
    uint256 public startTime;
    uint256 public endTime;
    address public feeReceiver;
    uint256 public tokensForSale;
    uint256 public tokensSold;
    bool public isFinished;

    error InvalidStartTime(string message);
    error InvalidEndTime(string message);
    error InvalidFeeReceiver();
    error OutOfSalePeriod();
    error SaleActive();
    error UnsuccessfulWithdrawal();
    error AlreadyFinished();
    error InputValueTooSmall();
    error InsufficientTokens();

    event SaleInitialized(
        uint256 startTime,
        uint256 endTime,
        uint256 price,
        address feeReceiver,
        address token,
        uint256 tokensForSale
    );

    event TokensPurchased(
        address indexed buyer,
        address indexed receiver,
        uint256 ethAmount,
        uint256 tokenAmount
    );

    event SaleFinalized(
        uint256 tokensSold,
        uint256 ethRaised,
        uint256 remainingTokens
    );

    constructor(address owner) Ownable(owner) {}

    /**
     * Set initial Crowdsawe parameters
     * @param _startTime start of the sale
     * @param _endTime end of the sale
     * @param _rateETH how much tokens are sold for 1 ETH
     */
    function initialize(
        uint256 _startTime,
        uint256 _endTime,
        uint256 _rateETH,
        address _feeReceiver,
        address _token,
        uint256 _tokensForSale
    ) external onlyOwner {
        if (_startTime < block.timestamp) {
            revert InvalidStartTime("Start time must be in the future");
        }

        if (_startTime > block.timestamp + 10 days) {
            revert InvalidStartTime("Start time must be within 10 days");
        }

        if (_endTime < _startTime + MIN_SALE_PERIOD) {
            revert InvalidEndTime(
                "End time must be at least MIN_SALE_PERIOD after start time"
            );
        }

        if (_feeReceiver == address(0)) {
            revert InvalidFeeReceiver();
        }

        startTime = _startTime;
        endTime = _endTime;
        price = _rateETH;
        feeReceiver = _feeReceiver;
        token = _token;
        tokensForSale = _tokensForSale;

        ICustomToken(token).transferFrom(
            msg.sender,
            address(this),
            tokensForSale
        );

        emit SaleInitialized(
            startTime,
            endTime,
            price,
            feeReceiver,
            token,
            tokensForSale
        );
    }

    function buyShares(address receiver) external payable {
        if (
            block.timestamp < startTime ||
            block.timestamp > endTime ||
            isFinished
        ) {
            revert OutOfSalePeriod();
        }

        uint256 tokensToReceive = (msg.value *
            price *
            (10 ** ICustomToken(token).decimals())) / 1 ether;

        if (tokensToReceive == 0) {
            revert InputValueTooSmall();
        }

        if (tokensSold + tokensToReceive > tokensForSale) {
            revert InsufficientTokens();
        }

        tokensSold += tokensToReceive;

        ICustomToken(token).transfer(receiver, tokensToReceive);

        emit TokensPurchased(msg.sender, receiver, msg.value, tokensToReceive);
    }

    function finalizeSale() external onlyOwner {
        if (isFinished) {
            revert AlreadyFinished();
        }

        if (tokensSold < tokensForSale && block.timestamp <= endTime) {
            revert SaleActive();
        }

        isFinished = true;

        uint256 remainingTokens = ICustomToken(token).balanceOf(address(this));
        uint256 ethRaised = address(this).balance;

        (bool success, ) = feeReceiver.call{value: ethRaised}("");
        if (!success) {
            revert UnsuccessfulWithdrawal();
        }

        ICustomToken(token).transfer(owner(), remainingTokens);

        emit SaleFinalized(tokensSold, ethRaised, remainingTokens);
    }
}


