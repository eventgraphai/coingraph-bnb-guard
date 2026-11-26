// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title CoinGraph ProofLog (opBNB)
/// @notice CoinGraph records the hash of every answer here when it is issued, before any trade.
///         Anyone can later match an answer to this log on opBNBScan and see what the agent knew, and when.
contract ProofLog {
    address public immutable recorder;

    event Answered(bytes32 indexed answerHash, address indexed token, uint8 verdict, uint256 chainId, bytes32 evidenceHash, uint64 issuedAt);

    constructor(address recorder_) {
        recorder = recorder_;
    }

    function record(bytes32 answerHash, address token, uint8 verdict, uint256 chainId, bytes32 evidenceHash, uint64 issuedAt) external {
        require(msg.sender == recorder, "recorder only");
        emit Answered(answerHash, token, verdict, chainId, evidenceHash, issuedAt);
    }
}
