pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ConflictResolver is ZamaEthereumConfig {
    struct Dispute {
        address partyA;
        address partyB;
        euint32 encryptedEvidenceA;
        euint32 encryptedEvidenceB;
        uint32 decryptedResult;
        bool resolved;
        uint256 timestamp;
    }

    mapping(uint256 => Dispute) public disputes;
    uint256 public disputeCount;

    event DisputeCreated(uint256 indexed id, address partyA, address partyB);
    event EvidenceSubmitted(uint256 indexed id, address party, euint32 encryptedEvidence);
    event ResolutionComputed(uint256 indexed id, uint32 result);

    constructor() ZamaEthereumConfig() {
        disputeCount = 0;
    }

    function createDispute(address partyB) external returns (uint256) {
        uint256 id = disputeCount++;
        disputes[id] = Dispute({
            partyA: msg.sender,
            partyB: partyB,
            encryptedEvidenceA: euint32(0),
            encryptedEvidenceB: euint32(0),
            decryptedResult: 0,
            resolved: false,
            timestamp: block.timestamp
        });
        emit DisputeCreated(id, msg.sender, partyB);
        return id;
    }

    function submitEvidence(uint256 id, externalEuint32 encryptedEvidence, bytes calldata inputProof) external {
        Dispute storage dispute = disputes[id];
        require(msg.sender == dispute.partyA || msg.sender == dispute.partyB, "Not authorized");
        require(!dispute.resolved, "Dispute already resolved");

        if (msg.sender == dispute.partyA) {
            require(FHE.isInitialized(FHE.fromExternal(encryptedEvidence, inputProof)), "Invalid encrypted evidence");
            dispute.encryptedEvidenceA = FHE.fromExternal(encryptedEvidence, inputProof);
            FHE.allowThis(dispute.encryptedEvidenceA);
        } else {
            require(FHE.isInitialized(FHE.fromExternal(encryptedEvidence, inputProof)), "Invalid encrypted evidence");
            dispute.encryptedEvidenceB = FHE.fromExternal(encryptedEvidence, inputProof);
            FHE.allowThis(dispute.encryptedEvidenceB);
        }

        emit EvidenceSubmitted(id, msg.sender, FHE.fromExternal(encryptedEvidence, inputProof));
    }

    function resolveDispute(uint256 id) external {
        Dispute storage dispute = disputes[id];
        require(!dispute.resolved, "Dispute already resolved");
        require(FHE.isInitialized(dispute.encryptedEvidenceA), "Party A evidence missing");
        require(FHE.isInitialized(dispute.encryptedEvidenceB), "Party B evidence missing");

        euint32 encryptedResult = FHE.add(dispute.encryptedEvidenceA, dispute.encryptedEvidenceB);
        FHE.makePubliclyDecryptable(encryptedResult);

        dispute.resolved = true;
        emit ResolutionComputed(id, 0); // Placeholder for actual decrypted result
    }

    function getDispute(uint256 id) external view returns (
        address partyA,
        address partyB,
        euint32 encryptedEvidenceA,
        euint32 encryptedEvidenceB,
        uint32 decryptedResult,
        bool resolved,
        uint256 timestamp
    ) {
        Dispute storage dispute = disputes[id];
        return (
            dispute.partyA,
            dispute.partyB,
            dispute.encryptedEvidenceA,
            dispute.encryptedEvidenceB,
            dispute.decryptedResult,
            dispute.resolved,
            dispute.timestamp
        );
    }

    function getDisputeCount() external view returns (uint256) {
        return disputeCount;
    }

    function verifyDecryption(uint256 id, bytes memory abiEncodedClearValue, bytes memory decryptionProof) external {
        Dispute storage dispute = disputes[id];
        require(dispute.resolved, "Dispute not resolved");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(FHE.add(dispute.encryptedEvidenceA, dispute.encryptedEvidenceB));

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        dispute.decryptedResult = decodedValue;
    }
}


