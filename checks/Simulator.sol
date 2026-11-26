// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Never deployed. The check places this code at a throwaway address through an eth_call state override,
// gives it some BNB, and runs a buy then a sell on PancakeSwap in one call. Nothing is spent on chain.

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface IRouter {
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory);
    function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external payable;
    function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external;
}

contract Simulator {
    // status: 0 = buy and sell worked, 1 = quote failed, 2 = buy failed, 3 = approve failed, 4 = sell failed
    struct Result {
        uint8 status;
        uint256 buyExpected;
        uint256 buyReceived;
        uint256 sellExpected;
        uint256 sellReceived;
        uint256 buyGas;
        uint256 sellGas;
    }

    receive() external payable {}

    function simulate(address router, address[] calldata buyPath) external payable returns (Result memory r) {
        address token = buyPath[buyPath.length - 1];
        address[] memory sellPath = new address[](buyPath.length);
        for (uint256 i = 0; i < buyPath.length; i++) sellPath[i] = buyPath[buyPath.length - 1 - i];

        try IRouter(router).getAmountsOut(msg.value, buyPath) returns (uint256[] memory a) {
            r.buyExpected = a[a.length - 1];
        } catch {
            r.status = 1;
            return r;
        }

        uint256 before = IERC20(token).balanceOf(address(this));
        uint256 g = gasleft();
        try IRouter(router).swapExactETHForTokensSupportingFeeOnTransferTokens{value: msg.value}(0, buyPath, address(this), block.timestamp + 60) {
            r.buyGas = g - gasleft();
        } catch {
            r.status = 2;
            return r;
        }
        r.buyReceived = IERC20(token).balanceOf(address(this)) - before;

        try IERC20(token).approve(router, type(uint256).max) returns (bool) {} catch {
            r.status = 3;
            return r;
        }

        try IRouter(router).getAmountsOut(r.buyReceived, sellPath) returns (uint256[] memory a) {
            r.sellExpected = a[a.length - 1];
        } catch {}

        uint256 ethBefore = address(this).balance;
        g = gasleft();
        try IRouter(router).swapExactTokensForETHSupportingFeeOnTransferTokens(r.buyReceived, 0, sellPath, address(this), block.timestamp + 60) {
            r.sellGas = g - gasleft();
        } catch {
            r.status = 4;
            return r;
        }
        r.sellReceived = address(this).balance - ethBefore;
    }
}
