// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title DigitalWill
 * @dev A decentralized will system with flexible execution conditions (Time, Death, Age).
 * Beneficiaries can claim their allocated funds after all conditions are met and the will is executed.
 */
contract DigitalWill {
    struct WillData {
        address owner;
        string primaryBeneficiary;
        string metadataCid;
        
        // Multi-Condition Support
        bool requiresDeath;
        bool requiresAge;
        bool deathVerified;
        uint256 releaseTime; 
        uint256 minAge;      
        uint256 ownerDOB;    
        
        bool executed;
        bool revoked;
        uint256 fundedAmountWei;
        uint256 beneficiaryCount;
        uint256 createdAt;
    }

    struct Beneficiary {
        address beneficiaryAddress;
        uint256 shareBps; 
    }

    struct NewWillParams {
        string willId;
        address primaryBeneficiary;
        string metadataCid;
        uint256 releaseTime;
        bool requiresDeath;
        uint256 minAge;
        uint256 ownerDOB;
    }

    mapping(string => WillData) public wills;
    mapping(string => Beneficiary[]) public willBeneficiaries;
    mapping(string => mapping(address => uint256)) public claimableAmounts;
    mapping(string => mapping(address => bool)) public hasClaimed;
    mapping(string => string[]) public willNominees;

    // Events
    event WillCreated(string indexed willId, address indexed owner, uint256 releaseTime);
    event WillFunded(string indexed willId, uint256 amount);
    event WillExecuted(string indexed willId, uint256 totalPayout);
    event WillRevoked(string indexed willId);
    event DeathVerified(string indexed willId);
    event FundsClaimed(string indexed willId, address indexed beneficiary, uint256 amount);

    address public backendSigner;

    constructor() {
        backendSigner = msg.sender;
    }

    modifier onlyOwner(string memory _willId) {
        require(wills[_willId].owner == msg.sender, "Not the owner");
        _;
    }

    modifier onlyBackend() {
        require(msg.sender == backendSigner, "Unauthorized: Only backend");
        _;
    }

    function setBackendSigner(address _newSigner) public onlyBackend {
        backendSigner = _newSigner;
    }

    function createWill(NewWillParams calldata p) public {
        require(wills[p.willId].owner == address(0), "Will already exists");

        WillData storage w = wills[p.willId];
        w.owner = msg.sender;
        w.metadataCid = p.metadataCid;
        w.requiresDeath = p.requiresDeath;
        w.requiresAge = p.minAge > 0;
        w.deathVerified = false;
        w.releaseTime = p.releaseTime;
        w.minAge = p.minAge;
        w.ownerDOB = p.ownerDOB;
        w.executed = false;
        w.revoked = false;
        w.fundedAmountWei = 0;
        w.beneficiaryCount = 1;
        w.createdAt = block.timestamp;

        willBeneficiaries[p.willId].push(Beneficiary({
            beneficiaryAddress: p.primaryBeneficiary,
            shareBps: 10000 
        }));

        emit WillCreated(p.willId, msg.sender, p.releaseTime);
    }

    function setBeneficiaries(
        string memory _willId,
        address[] memory _addresses,
        uint256[] memory _sharesBps
    ) public onlyOwner(_willId) {
        require(!wills[_willId].executed, "Already executed");
        require(_addresses.length == _sharesBps.length, "Mismatched arrays");

        delete willBeneficiaries[_willId];
        uint256 totalBps = 0;
        for (uint256 i = 0; i < _addresses.length; i++) {
            willBeneficiaries[_willId].push(Beneficiary({
                beneficiaryAddress: _addresses[i],
                shareBps: _sharesBps[i]
            }));
            totalBps += _sharesBps[i];
        }
        require(totalBps == 10000, "Total must be 10000 bps (100%)");
        wills[_willId].beneficiaryCount = _addresses.length;
    }

    function fundWill(string memory _willId) public payable {
        require(wills[_willId].owner != address(0), "Will does not exist");
        require(!wills[_willId].executed, "Already executed");
        require(!wills[_willId].revoked, "Revoked");

        wills[_willId].fundedAmountWei += msg.value;
        emit WillFunded(_willId, msg.value);
    }

    function verifyDeath(string memory _willId) public onlyBackend {
        require(wills[_willId].requiresDeath, "Death condition not required");
        wills[_willId].deathVerified = true;
        emit DeathVerified(_willId);
    }

    function canExecute(string memory _willId) public view returns (bool) {
        WillData storage w = wills[_willId];
        if (w.owner == address(0) || w.executed || w.revoked) return false;

        bool timeOk = (w.releaseTime == 0) || (block.timestamp >= w.releaseTime);
        bool deathOk = (!w.requiresDeath) || (w.deathVerified);
        bool ageOk = true;
        if (w.requiresAge) {
            uint256 currentAge = (block.timestamp - w.ownerDOB) / 365 days;
            ageOk = (currentAge >= w.minAge);
        }

        return (timeOk && deathOk && ageOk);
    }

    function executeWill(string memory _willId) public {
        require(canExecute(_willId), "Conditions not met yet");
        
        WillData storage w = wills[_willId];
        uint256 totalFunds = w.fundedAmountWei;
        require(totalFunds > 0, "No funds to distribute");

        Beneficiary[] storage bens = willBeneficiaries[_willId];
        for (uint256 i = 0; i < bens.length; i++) {
            uint256 payout = (totalFunds * bens[i].shareBps) / 10000;
            claimableAmounts[_willId][bens[i].beneficiaryAddress] += payout;
        }

        w.executed = true;
        w.fundedAmountWei = 0; 

        emit WillExecuted(_willId, totalFunds);
    }

    function claimMyFunds(string memory _willId) public {
        require(wills[_willId].executed, "Will not executed yet");
        uint256 amount = claimableAmounts[_willId][msg.sender];
        require(amount > 0, "No funds available for claim");
        require(!hasClaimed[_willId][msg.sender], "Already claimed");

        hasClaimed[_willId][msg.sender] = true;
        payable(msg.sender).transfer(amount);

        emit FundsClaimed(_willId, msg.sender, amount);
    }

    function revokeWill(string memory _willId) public onlyOwner(_willId) {
        require(!wills[_willId].executed, "Already executed");
        wills[_willId].revoked = true;
        uint256 refund = wills[_willId].fundedAmountWei;
        wills[_willId].fundedAmountWei = 0;
        
        if (refund > 0) {
            payable(msg.sender).transfer(refund);
        }
        
        emit WillRevoked(_willId);
    }

    function getBeneficiaries(string memory _willId) public view returns (Beneficiary[] memory) {
        return willBeneficiaries[_willId];
    }
}