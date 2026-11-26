// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Atlas Oracle pull-oracle consumer SDK (@atlas-oracle/pull-oracle-consumer 1.0.0), BUSL-1.1, vendored unchanged
// under contracts/vendor/atlas. It verifies Atlas's signed price packages appended to this call's calldata.
import {PullOracleConsumerStandard} from "vendor/atlas/PullOracleConsumerStandard.sol";

interface IRouterV2A {
    function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external payable;
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory);
}

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

/// @title CoinGraph Guard (with Atlas Oracle check on chain)
/// @notice Wraps a PancakeSwap buy. Two checks happen inside the same transaction:
///         1. CoinGraph's signed answer must say "proceed" for this agent, this token and at most this amount.
///         2. When the answer names an Atlas Oracle feed, the price the agent is about to pay must be within
///            `maxDevBps` of Atlas's signed price. The Atlas signature and freshness (under 180 seconds) are verified
///            here on chain by Atlas's own consumer code, so neither CoinGraph nor the agent can fake the reference price.
contract CoinGraphGuardAtlas is PullOracleConsumerStandard {
    uint8 public constant PROCEED = 1;

    struct Answer {
        address agent;        // who may use this answer
        address token;        // the token that was checked
        uint256 maxAmountIn;  // largest BNB amount (wei) the answer covers
        uint8 verdict;        // 1 proceed, 2 caution, 3 avoid
        uint64 issuedAt;      // unix seconds
        bytes32 evidenceHash; // hash of the full check result (findings and numbers)
        bytes4 atlasFeedId;   // Atlas feed that prices this token; 0 means no oracle check
        uint16 maxDevBps;     // largest allowed gap between the price paid and Atlas's price, in basis points
    }

    bytes32 private constant ANSWER_TYPEHASH = keccak256(
        "Answer(address agent,address token,uint256 maxAmountIn,uint8 verdict,uint64 issuedAt,bytes32 evidenceHash,bytes4 atlasFeedId,uint16 maxDevBps)"
    );
    bytes32 public immutable DOMAIN_SEPARATOR;

    address public immutable router;
    address public immutable wbnb;
    address public immutable usd; // USDT on BNB Smart Chain (18 decimals), used to price BNB
    address public signer;
    address public admin;
    uint256 public maxAge = 300;
    mapping(bytes32 => bool) public used;

    event GuardedSwap(bytes32 indexed answerHash, address indexed agent, address indexed token, uint256 amountIn, bytes32 evidenceHash);
    event AtlasChecked(bytes32 indexed answerHash, bytes4 indexed feedId, uint256 pricePaidUsd, uint256 atlasPriceUsd, uint256 atlasTimestamp, uint256 gapBps);
    event SignerChanged(address signer);

    error WrongSigner();
    error NotYourAnswer();
    error WrongToken();
    error WrongPath();
    error AnswerExpired();
    error AnswerUsed();
    error AmountTooLarge();
    error NotProceed(uint8 verdict);
    error OracleDeviation(bytes4 feedId, uint256 pricePaidUsd, uint256 atlasPriceUsd, uint256 gapBps);

    constructor(address router_, address wbnb_, address usd_, address signer_) {
        router = router_;
        wbnb = wbnb_;
        usd = usd_;
        signer = signer_;
        admin = msg.sender;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("CoinGraph Guard"),
                keccak256("2"),
                block.chainid,
                address(this)
            )
        );
    }

    function setSigner(address s) external {
        require(msg.sender == admin, "admin only");
        signer = s;
        emit SignerChanged(s);
    }

    function answerHash(Answer calldata a) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(ANSWER_TYPEHASH, a.agent, a.token, a.maxAmountIn, a.verdict, a.issuedAt, a.evidenceHash, a.atlasFeedId, a.maxDevBps)
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    /// @notice USD price (18 decimals) per whole token that this buy would pay, from the PancakeSwap route itself.
    function pricePaidUsd(uint256 amountIn, address[] calldata path) public view returns (uint256) {
        uint256[] memory outs = IRouterV2A(router).getAmountsOut(amountIn, path);
        uint256 out = outs[outs.length - 1];
        if (out == 0) return type(uint256).max;
        address[] memory bnbUsd = new address[](2);
        bnbUsd[0] = wbnb;
        bnbUsd[1] = usd;
        uint256 usdIn = IRouterV2A(router).getAmountsOut(amountIn, bnbUsd)[1];
        return (usdIn * (10 ** IERC20Decimals(path[path.length - 1]).decimals())) / out;
    }

    /// @notice Buy `path[last]` with BNB through PancakeSwap. Only a fresh "proceed" from CoinGraph goes through, and,
    ///         when the answer names an Atlas feed, only at a price close to Atlas's signed price.
    ///         Atlas's signed payload (packages, signature, marker) is appended after the normal calldata.
    function buy(Answer calldata a, bytes calldata sig, uint256 amountOutMin, address[] calldata path, uint256 deadline) external payable {
        bytes32 h = answerHash(a);
        if (_recover(h, sig) != signer) revert WrongSigner();
        if (a.agent != msg.sender) revert NotYourAnswer();
        if (path[0] != wbnb) revert WrongPath();
        if (a.token != path[path.length - 1]) revert WrongToken();
        if (block.timestamp > a.issuedAt + maxAge) revert AnswerExpired();
        if (used[h]) revert AnswerUsed();
        if (msg.value > a.maxAmountIn) revert AmountTooLarge();

        if (a.atlasFeedId != bytes4(0)) {
            // Verifies Atlas's signature and freshness on chain; reverts if the feed is missing, stale or not signed by Atlas.
            (uint256 atlasUsd, uint256 atlasTs) = _getVerifiedFeedData(a.atlasFeedId);
            uint256 paid = pricePaidUsd(msg.value, path);
            uint256 gap = paid > atlasUsd ? paid - atlasUsd : atlasUsd - paid;
            uint256 gapBps = atlasUsd == 0 ? type(uint256).max : (gap * 10_000) / atlasUsd;
            if (gapBps > a.maxDevBps) revert OracleDeviation(a.atlasFeedId, paid, atlasUsd, gapBps);
            emit AtlasChecked(h, a.atlasFeedId, paid, atlasUsd, atlasTs, gapBps);
        }

        if (a.verdict != PROCEED) revert NotProceed(a.verdict);
        used[h] = true;
        IRouterV2A(router).swapExactETHForTokensSupportingFeeOnTransferTokens{value: msg.value}(amountOutMin, path, msg.sender, deadline);
        emit GuardedSwap(h, msg.sender, a.token, msg.value, a.evidenceHash);
    }

    function _recover(bytes32 h, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        return ecrecover(h, v, r, s);
    }
}
