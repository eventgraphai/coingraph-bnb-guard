// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRouterV2 {
    function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external payable;
}

/// @title CoinGraph Guard
/// @notice Wraps a PancakeSwap buy. The trade goes through only with a recent answer signed by CoinGraph that says
///         "proceed" for this token, this agent and at most this amount. "avoid" or "caution" makes the transaction revert.
contract CoinGraphGuard {
    uint8 public constant PROCEED = 1;
    uint8 public constant CAUTION = 2;
    uint8 public constant AVOID = 3;

    struct Answer {
        address agent;        // who may use this answer
        address token;        // the token that was checked
        uint256 maxAmountIn;  // largest BNB amount (wei) the answer covers
        uint8 verdict;        // 1 proceed, 2 caution, 3 avoid
        uint64 issuedAt;      // unix seconds
        bytes32 evidenceHash; // hash of the full check result (findings and numbers)
    }

    bytes32 private constant ANSWER_TYPEHASH =
        keccak256("Answer(address agent,address token,uint256 maxAmountIn,uint8 verdict,uint64 issuedAt,bytes32 evidenceHash)");
    bytes32 public immutable DOMAIN_SEPARATOR;

    address public immutable router;
    address public signer;
    address public admin;
    uint256 public maxAge = 300; // an answer is valid for 5 minutes
    mapping(bytes32 => bool) public used;

    event GuardedSwap(bytes32 indexed answerHash, address indexed agent, address indexed token, uint256 amountIn, bytes32 evidenceHash);
    event SignerChanged(address signer);

    error WrongSigner();
    error NotYourAnswer();
    error WrongToken();
    error AnswerExpired();
    error AnswerUsed();
    error AmountTooLarge();
    error NotProceed(uint8 verdict);

    constructor(address router_, address signer_) {
        router = router_;
        signer = signer_;
        admin = msg.sender;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("CoinGraph Guard"),
                keccak256("1"),
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
        bytes32 structHash = keccak256(abi.encode(ANSWER_TYPEHASH, a.agent, a.token, a.maxAmountIn, a.verdict, a.issuedAt, a.evidenceHash));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    /// @notice Buy `path[last]` with BNB through PancakeSwap, only if CoinGraph said proceed.
    function buy(Answer calldata a, bytes calldata sig, uint256 amountOutMin, address[] calldata path, uint256 deadline) external payable {
        bytes32 h = answerHash(a);
        if (_recover(h, sig) != signer) revert WrongSigner();
        if (a.agent != msg.sender) revert NotYourAnswer();
        if (a.token != path[path.length - 1]) revert WrongToken();
        if (block.timestamp > a.issuedAt + maxAge) revert AnswerExpired();
        if (used[h]) revert AnswerUsed();
        if (msg.value > a.maxAmountIn) revert AmountTooLarge();
        if (a.verdict != PROCEED) revert NotProceed(a.verdict);
        used[h] = true;
        IRouterV2(router).swapExactETHForTokensSupportingFeeOnTransferTokens{value: msg.value}(amountOutMin, path, msg.sender, deadline);
        emit GuardedSwap(h, msg.sender, a.token, msg.value, a.evidenceHash);
    }

    function _recover(bytes32 h, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        // Reject malleable signatures (upper half of the curve order).
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        return ecrecover(h, v, r, s);
    }
}
