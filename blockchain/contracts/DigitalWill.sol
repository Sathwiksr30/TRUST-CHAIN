// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DigitalWill {
    uint16 public constant SHARE_SCALE = 10_000;

    struct WillData {
        address owner;
        address executor;
        string cid;
        uint256 releaseTime;
        uint256 fundedAmount;
        uint16 totalShares;
        bool executed;
        bool revoked;
    }

    struct BeneficiaryData {
        uint16 shareBps;
        bool exists;
    }

    mapping(bytes32 => WillData) private willById;
    mapping(bytes32 => mapping(address => BeneficiaryData)) private beneficiaryByWill;
    mapping(bytes32 => address[]) private beneficiaryListByWill;

    error WillAlreadyExists();
    error WillNotFound();
    error InvalidAddress();
    error InvalidInput();
    error NotWillOwner();
    error NotAuthorized();
    error WillRevoked();
    error WillAlreadyExecuted();
    error ConditionNotMet();
    error NoFundsAvailable();
    error TransferFailed();
    error InvalidShares();

    event WillCreated(
        string willId,
        address owner,
        address beneficiary,
        string cid,
        uint256 releaseTime
    );

    event WillConfigured(
        string willId,
        address owner,
        address executor,
        string cid,
        uint256 releaseTime
    );

    event ExecutorUpdated(string willId, address executor);
    event BeneficiariesUpdated(string willId, uint256 count, uint16 totalShares);
    event WillFunded(string willId, address from, uint256 amount, uint256 totalFunded);
    event InheritancePaid(string willId, address beneficiary, uint256 amount);
    event WillRevokedAndRefunded(string willId, address owner, uint256 refundedAmount);

    event WillExecuted(
        string willId,
        address beneficiary
    );

    modifier onlyWillOwner(string memory willId) {
        bytes32 willKey = _willKey(willId);
        WillData storage w = willById[willKey];
        if (w.owner == address(0)) revert WillNotFound();
        if (w.owner != msg.sender) revert NotWillOwner();
        _;
    }

    function _willKey(string memory willId) private pure returns (bytes32) {
        return keccak256(bytes(willId));
    }

    function _ensureUpdatable(WillData storage w) private view {
        if (w.revoked) revert WillRevoked();
        if (w.executed) revert WillAlreadyExecuted();
    }

    function _createWillBase(
        string memory willId,
        address executor,
        string memory cid,
        uint256 releaseTime
    ) private returns (bytes32 willKey) {
        if (bytes(willId).length == 0 || bytes(cid).length == 0) revert InvalidInput();
        if (executor == address(0)) revert InvalidAddress();
        if (releaseTime < block.timestamp) revert InvalidInput();

        willKey = _willKey(willId);
        if (willById[willKey].owner != address(0)) revert WillAlreadyExists();

        willById[willKey] = WillData({
            owner: msg.sender,
            executor: executor,
            cid: cid,
            releaseTime: releaseTime,
            fundedAmount: 0,
            totalShares: 0,
            executed: false,
            revoked: false
        });
    }

    function _setBeneficiaries(
        bytes32 willKey,
        address[] memory beneficiaries,
        uint16[] memory sharesBps
    ) private {
        if (beneficiaries.length == 0 || beneficiaries.length != sharesBps.length) {
            revert InvalidInput();
        }

        uint256 existingCount = beneficiaryListByWill[willKey].length;
        for (uint256 i = 0; i < existingCount; i++) {
            address oldBeneficiary = beneficiaryListByWill[willKey][i];
            delete beneficiaryByWill[willKey][oldBeneficiary];
        }
        delete beneficiaryListByWill[willKey];

        uint256 runningTotal;
        for (uint256 i = 0; i < beneficiaries.length; i++) {
            address account = beneficiaries[i];
            uint16 share = sharesBps[i];

            if (account == address(0)) revert InvalidAddress();
            if (share == 0) revert InvalidShares();
            if (beneficiaryByWill[willKey][account].exists) revert InvalidInput();

            beneficiaryByWill[willKey][account] = BeneficiaryData({
                shareBps: share,
                exists: true
            });
            beneficiaryListByWill[willKey].push(account);
            runningTotal += share;
        }

        if (runningTotal != SHARE_SCALE) revert InvalidShares();
        willById[willKey].totalShares = uint16(runningTotal);
    }

    function createWill(
        string memory willId,
        address beneficiary,
        string memory cid,
        uint256 releaseTime
    ) public {
        bytes32 willKey = _createWillBase(willId, msg.sender, cid, releaseTime);
        address[] memory beneficiaries = new address[](1);
        uint16[] memory shares = new uint16[](1);
        beneficiaries[0] = beneficiary;
        shares[0] = SHARE_SCALE;
        _setBeneficiaries(willKey, beneficiaries, shares);

        emit WillCreated(
            willId,
            msg.sender,
            beneficiary,
            cid,
            releaseTime
        );

        emit WillConfigured(
            willId,
            msg.sender,
            msg.sender,
            cid,
            releaseTime
        );
    }

    function createWillWithExecutor(
        string memory willId,
        address executor,
        string memory cid,
        uint256 releaseTime
    ) external {
        _createWillBase(willId, executor, cid, releaseTime);
        emit WillConfigured(willId, msg.sender, executor, cid, releaseTime);
    }

    function setExecutor(string memory willId, address executor) external onlyWillOwner(willId) {
        if (executor == address(0)) revert InvalidAddress();

        bytes32 willKey = _willKey(willId);
        WillData storage w = willById[willKey];
        _ensureUpdatable(w);

        w.executor = executor;
        emit ExecutorUpdated(willId, executor);
    }

    function setBeneficiaries(
        string memory willId,
        address[] calldata beneficiaries,
        uint16[] calldata sharesBps
    ) external onlyWillOwner(willId) {
        bytes32 willKey = _willKey(willId);
        WillData storage w = willById[willKey];
        _ensureUpdatable(w);

        _setBeneficiaries(willKey, beneficiaries, sharesBps);
        emit BeneficiariesUpdated(willId, beneficiaries.length, w.totalShares);
    }

    function fundWill(string memory willId) external payable onlyWillOwner(willId) {
        if (msg.value == 0) revert InvalidInput();

        bytes32 willKey = _willKey(willId);
        WillData storage w = willById[willKey];
        _ensureUpdatable(w);

        w.fundedAmount += msg.value;
        emit WillFunded(willId, msg.sender, msg.value, w.fundedAmount);
    }

    function executeWill(string memory willId) public {
        bytes32 willKey = _willKey(willId);
        WillData storage w = willById[willKey];
        if (w.owner == address(0)) revert WillNotFound();
        if (w.revoked) revert WillRevoked();
        if (w.executed) revert WillAlreadyExecuted();
        if (block.timestamp < w.releaseTime) revert ConditionNotMet();
        if (w.fundedAmount == 0) revert NoFundsAvailable();

        bool callerIsBeneficiary = beneficiaryByWill[willKey][msg.sender].exists;
        if (msg.sender != w.owner && msg.sender != w.executor && !callerIsBeneficiary) {
            revert NotAuthorized();
        }

        address[] storage beneficiaries = beneficiaryListByWill[willKey];
        if (beneficiaries.length == 0 || w.totalShares != SHARE_SCALE) revert InvalidShares();

        w.executed = true;

        uint256 totalAmount = w.fundedAmount;
        w.fundedAmount = 0;
        uint256 remaining = totalAmount;

        for (uint256 i = 0; i < beneficiaries.length; i++) {
            address account = beneficiaries[i];
            uint256 payout;

            if (i == beneficiaries.length - 1) {
                payout = remaining;
            } else {
                uint16 share = beneficiaryByWill[willKey][account].shareBps;
                payout = (totalAmount * share) / SHARE_SCALE;
                remaining -= payout;
            }

            (bool sent, ) = payable(account).call{value: payout}("");
            if (!sent) revert TransferFailed();

            emit InheritancePaid(willId, account, payout);
        }

        emit WillExecuted(willId, msg.sender);
    }

    function revokeWill(string memory willId) external onlyWillOwner(willId) {
        bytes32 willKey = _willKey(willId);
        WillData storage w = willById[willKey];
        _ensureUpdatable(w);

        w.revoked = true;

        uint256 refund = w.fundedAmount;
        if (refund > 0) {
            w.fundedAmount = 0;
            (bool sent, ) = payable(w.owner).call{value: refund}("");
            if (!sent) revert TransferFailed();
        }

        emit WillRevokedAndRefunded(willId, w.owner, refund);
    }

    function getWill(
        string memory willId
    ) external view returns (
        address owner,
        address executor,
        string memory cid,
        uint256 releaseTime,
        uint256 fundedAmount,
        uint16 totalShares,
        bool executed,
        bool revoked,
        uint256 beneficiaryCount
    ) {
        bytes32 willKey = _willKey(willId);
        WillData storage w = willById[willKey];
        if (w.owner == address(0)) revert WillNotFound();

        return (
            w.owner,
            w.executor,
            w.cid,
            w.releaseTime,
            w.fundedAmount,
            w.totalShares,
            w.executed,
            w.revoked,
            beneficiaryListByWill[willKey].length
        );
    }

    function getBeneficiaries(
        string memory willId
    ) external view returns (address[] memory beneficiaries, uint16[] memory sharesBps) {
        bytes32 willKey = _willKey(willId);
        if (willById[willKey].owner == address(0)) revert WillNotFound();

        address[] memory list = beneficiaryListByWill[willKey];
        uint16[] memory shares = new uint16[](list.length);
        for (uint256 i = 0; i < list.length; i++) {
            shares[i] = beneficiaryByWill[willKey][list[i]].shareBps;
        }

        return (list, shares);
    }

    function wills(
        string memory willId
    ) external view returns (
        address owner,
        address beneficiary,
        string memory cid,
        uint256 releaseTime,
        bool executed
    ) {
        bytes32 willKey = _willKey(willId);
        WillData storage w = willById[willKey];
        if (w.owner == address(0)) revert WillNotFound();

        address firstBeneficiary = address(0);
        if (beneficiaryListByWill[willKey].length > 0) {
            firstBeneficiary = beneficiaryListByWill[willKey][0];
        }

        return (w.owner, firstBeneficiary, w.cid, w.releaseTime, w.executed);
    }

    receive() external payable {
        revert("Use fundWill");
    }
}