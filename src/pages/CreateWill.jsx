import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './CreateWill.css';
import { formatIndiaDateTime, toIndiaDateString, toIndiaIsoString } from '../utils/timezone';
import { getStoredDocuments, syncWillStatuses } from '../utils/willStatusSync';

const API_BASE = (
  process.env.REACT_APP_API_BASE_URL ||
  process.env.REACT_APP_BACKEND_URL ||
  `http://${window.location.hostname}:5000`
).replace(/\/$/, "");

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function extractAgeConditionFields(condition) {
  if (!condition || condition.type !== 'Age') {
    return { dob: '', currentAge: '', targetAge: '' };
  }

  if (condition.value && typeof condition.value === 'object') {
    return {
      dob: String(condition.value.dob || condition.dob || ''),
      currentAge: String(condition.value.currentAge || condition.currentAge || ''),
      targetAge: String(condition.value.targetAge || condition.targetAge || '')
    };
  }

  return {
    dob: String(condition.dob || ''),
    currentAge: String(condition.currentAge || ''),
    targetAge: String(condition.targetAge || condition.value || '')
  };
}

function computeAgeReleaseTime(dobInput, targetAgeInput) {
  const dob = String(dobInput || '').trim();
  const targetAge = Number(targetAgeInput);

  const match = dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || !Number.isFinite(targetAge) || targetAge <= 0) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const triggerYear = year + Math.floor(targetAge);

  const timestampMs = Date.parse(
    `${String(triggerYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+05:30`
  );

  if (Number.isNaN(timestampMs)) {
    return null;
  }

  return Math.floor(timestampMs / 1000);
}

function calculateCurrentAge(dobInput) {
  const dob = new Date(`${dobInput}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  const beforeBirthday = monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function isValidEvmAddress(value) {
  return EVM_ADDRESS_REGEX.test(String(value || '').trim());
}

function validateWillPayload(formData) {
  if (!String(formData?.testatorName || '').trim()) {
    return 'Testator name is required.';
  }

  if (!formData.willName?.trim()) {
    return 'Will name is required.';
  }

  const activeConditions = Array.isArray(formData.conditions)
    ? formData.conditions.filter(condition => condition?.type)
    : [];
  const multipleModeSelected = Array.isArray(formData.conditions)
    && formData.conditions.some(condition => condition?._multiple);

  if (multipleModeSelected) {
    const hasEmptySlot = formData.conditions.some(condition => !condition?.type);
    if (hasEmptySlot) {
      return 'Please choose a condition type for every row in Multiple Conditions.';
    }
    if (activeConditions.length < 2) {
      return 'Multiple Conditions requires at least two conditions.';
    }
  }

  const timeCondition = activeConditions.find(condition => condition.type === 'Time');
  const ageCondition = activeConditions.find(condition => condition.type === 'Age');
  const deathCondition = activeConditions.find(condition => condition.type === 'Death');
  if (timeCondition?.value) {
    const releaseDate = new Date(timeCondition.value);
    if (Number.isNaN(releaseDate.getTime())) {
      return 'Execution time is invalid.';
    }
    if (releaseDate.getTime() <= Date.now()) {
      return 'Execution time must be in the future.';
    }
  }

  if (ageCondition) {
    const ageFields = extractAgeConditionFields(ageCondition);
    const releaseTime = computeAgeReleaseTime(ageFields.dob, ageFields.targetAge);
    const enteredCurrentAge = Number(ageFields.currentAge);
    const derivedCurrentAge = calculateCurrentAge(ageFields.dob);

    if (!ageFields.dob) {
      return 'Beneficiary date of birth is required for Age condition.';
    }

    if (!Number.isFinite(enteredCurrentAge) || enteredCurrentAge < 0) {
      return 'Present age is required for Age condition.';
    }

    if (derivedCurrentAge !== null && enteredCurrentAge !== derivedCurrentAge) {
      return `Present age does not match DOB. Current age from DOB is ${derivedCurrentAge}.`;
    }

    if (!Number.isFinite(Number(ageFields.targetAge)) || Number(ageFields.targetAge) <= 0) {
      return 'Target age must be a valid positive number.';
    }

    if (Number(ageFields.targetAge) <= enteredCurrentAge) {
      return 'Target age must be greater than present age.';
    }

    if (!releaseTime) {
      return 'Age condition is invalid. Please check DOB and target age.';
    }

    if (releaseTime <= Math.floor(Date.now() / 1000)) {
      return 'Selected target age is already reached. Please choose a future age.';
    }
  }

  if (!isValidEvmAddress(formData.executorAddress)) {
    return 'Executor wallet address is invalid.';
  }

  const executorEmail = String(formData.executorEmail || '').trim();
  if (!executorEmail) {
    return 'Executor email is required.';
  }
  if (!EMAIL_REGEX.test(executorEmail)) {
    return 'Executor email is invalid.';
  }

  if (!Array.isArray(formData.beneficiaries) || formData.beneficiaries.length === 0) {
    return 'Add at least one beneficiary.';
  }

  if (!Array.isArray(formData.witnesses) || formData.witnesses.length === 0) {
    return 'Add at least one witness.';
  }

  for (const witness of formData.witnesses) {
    const witnessName = String(witness?.name || '').trim();
    const witnessAddress = String(witness?.address || '').trim();
    const witnessSignature = String(witness?.signature || '').trim();
    if (!witnessName || !witnessAddress || !witnessSignature) {
      return 'Each witness must include name, address, and signature.';
    }
  }

  if (deathCondition) {
    if (!Array.isArray(formData.nominees) || formData.nominees.length === 0) {
      return 'Add at least one nominee for Death condition.';
    }

    for (const nominee of formData.nominees) {
      const nomineeName = String(nominee?.name || '').trim();
      const nomineeEmail = String(nominee?.email || '').trim();
      const nomineeWallet = String(nominee?.walletAddress || '').trim();
      if (!nomineeName || !nomineeEmail) {
        return 'Each nominee must include name and email.';
      }
      if (!EMAIL_REGEX.test(nomineeEmail)) {
        return `Invalid nominee email: ${nomineeEmail}`;
      }
      if (nomineeWallet && !isValidEvmAddress(nomineeWallet)) {
        return `Invalid nominee wallet address: ${nomineeWallet}`;
      }
    }
  }

  const seenAddresses = new Set();
  let totalShare = 0;

  for (const beneficiary of formData.beneficiaries) {
    const name = String(beneficiary?.name || '').trim();
    const email = String(beneficiary?.email || '').trim();
    const walletAddress = String(beneficiary?.walletAddress || '').trim();
    const share = Number(beneficiary?.share);

    if (!name || !email) {
      return 'Each beneficiary must include name and email.';
    }

    if (!isValidEvmAddress(walletAddress)) {
      return `Invalid beneficiary wallet address: ${walletAddress || '(empty)'}`;
    }

    const normalizedAddress = walletAddress.toLowerCase();
    if (seenAddresses.has(normalizedAddress)) {
      return `Duplicate beneficiary wallet address found: ${walletAddress}`;
    }
    seenAddresses.add(normalizedAddress);

    if (!Number.isFinite(share) || share <= 0) {
      return `Invalid beneficiary share for ${name}.`;
    }

    totalShare += share;
  }

  if (Math.abs(totalShare - 100) > 1e-9) {
    return `Beneficiary shares must total exactly 100%. Current total is ${totalShare}%.`;
  }

  return null;
}

function CreateWill({ onNavigate }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [userWills, setUserWills] = useState([]);
  const [formData, setFormData] = useState({
    willName: '',
    testatorName: '',
    testatorGuardianName: '',
    testatorAge: '',
    testatorAddress: '',
    religion: '',
    dob: '',
    place: '',
    testatorSignature: '',
    witnesses: [{ name: '', address: '', signature: '' }],
    conditions: [],
    executorName: '',
    executorEmail: '',
    executorAddress: '',
    beneficiaries: [],
    nominees: [],
    assets: []
  });

  // Check if user is logged in
  const currentUser = localStorage.getItem('trustchain_user') || null;

  useEffect(() => {
    // Redirect to wallet connect if not logged in
    if (!currentUser) {
      onNavigate('home');
      return;
    }
    setIsLoading(false);
  }, [currentUser, onNavigate]);

  useEffect(() => {
    if (!currentUser) return;

    let isMounted = true;

    const updateWills = async () => {
      const synced = await syncWillStatuses(API_BASE, currentUser);
      if (!isMounted) return;

      const wills = synced
        .filter((doc) => String(doc?.type || '').toLowerCase() === 'will')
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      setUserWills(wills);
    };

    const loadInitial = () => {
      const stored = getStoredDocuments();
      const wills = stored
        .filter((doc) => String(doc?.type || '').toLowerCase() === 'will')
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      setUserWills(wills);
    };

    loadInitial();
    updateWills();

    const interval = setInterval(updateWills, 15000);
    window.addEventListener('focus', updateWills);

    return () => {
      isMounted = false;
      clearInterval(interval);
      window.removeEventListener('focus', updateWills);
    };
  }, [currentUser]);

  const steps = [
    { name: 'Initial', component: InitialView },
    { name: 'Basic Info', component: BasicInfo },
    { name: 'Executor', component: Executor },
    { name: 'Beneficiaries', component: Beneficiaries },
    { name: 'Assets', component: Assets },
    { name: 'Witness', component: WitnessDetails },
    { name: 'Review', component: Review }
  ];

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const addBeneficiary = (beneficiary) => {
    setFormData(prev => ({
      ...prev,
      beneficiaries: [...prev.beneficiaries, beneficiary]
    }));
  };

  const removeBeneficiary = (index) => {
    setFormData(prev => ({
      ...prev,
      beneficiaries: prev.beneficiaries.filter((_, i) => i !== index)
    }));
  };

  const addAsset = (asset) => {
    setFormData(prev => ({
      ...prev,
      assets: [...prev.assets, asset]
    }));
  };

  const addNominee = (nominee) => {
    setFormData(prev => ({
      ...prev,
      nominees: [...prev.nominees, nominee]
    }));
  };

  const removeNominee = (index) => {
    setFormData(prev => ({
      ...prev,
      nominees: prev.nominees.filter((_, i) => i !== index)
    }));
  };

  const removeAsset = (index) => {
    setFormData(prev => ({
      ...prev,
      assets: prev.assets.filter((_, i) => i !== index)
    }));
  };

  const addWitness = () => {
    setFormData(prev => ({
      ...prev,
      witnesses: [...(Array.isArray(prev.witnesses) ? prev.witnesses : []), { name: '', address: '', signature: '' }]
    }));
  };

  const removeWitness = (index) => {
    setFormData(prev => {
      const existing = Array.isArray(prev.witnesses) ? prev.witnesses : [];
      if (existing.length <= 1) return prev;
      return {
        ...prev,
        witnesses: existing.filter((_, i) => i !== index)
      };
    });
  };

  const updateWitness = (index, field, value) => {
    setFormData(prev => {
      const existing = Array.isArray(prev.witnesses) ? prev.witnesses : [];
      return {
        ...prev,
        witnesses: existing.map((witness, i) => (
          i === index ? { ...witness, [field]: value } : witness
        ))
      };
    });
  };

  const [creating, setCreating] = useState(false);

  const handleCreateWill = async () => {
    const validationError = validateWillPayload(formData);
    if (validationError) {
      alert(validationError);
      return;
    }

    // Build will payload
    const activeConditions = formData.conditions.filter(c => c.type);
    const timeCondition = activeConditions.find(c => c.type === 'Time');
    const ageCondition = activeConditions.find(c => c.type === 'Age');
    const ageFields = extractAgeConditionFields(ageCondition);
    const ageReleaseTime = ageCondition
      ? computeAgeReleaseTime(ageFields.dob, ageFields.targetAge)
      : null;
    const deathCondition = activeConditions.find(c => c.type === 'Death');
    const releaseTime = deathCondition
      ? undefined
      : (timeCondition?.value
      ? Math.floor(new Date(timeCondition.value).getTime() / 1000)
      : (ageReleaseTime || undefined));
    const conditionsDescription = activeConditions
      .map(c => {
        if (c.type === 'Time') return `Execute after ${formatIndiaDateTime(c.value)}`;
        if (c.type === 'Age') {
          const { dob, currentAge, targetAge } = extractAgeConditionFields(c);
          if (ageReleaseTime) {
            return `Execute when beneficiary turns ${targetAge} (DOB: ${dob}, present age: ${currentAge}) on ${formatIndiaDateTime(ageReleaseTime * 1000)}`;
          }
          return `Execute when beneficiary turns ${targetAge} (DOB: ${dob}, present age: ${currentAge})`;
        }
        if (c.type === 'Death') return 'Execute upon verified death';
        return '';
      })
      .filter(Boolean)
      .join('; ');

    const newWill = {
      id: `WILL-${Date.now()}`,
      name: formData.willName || 'Untitled Will',
      type: 'Will',
      testatorName: formData.testatorName,
      testatorGuardianName: formData.testatorGuardianName,
      testatorAge: formData.testatorAge,
      testatorAddress: formData.testatorAddress,
      religion: formData.religion,
      dob: formData.dob,
      place: formData.place,
      testatorSignature: formData.testatorSignature,
      witnesses: Array.isArray(formData.witnesses) ? formData.witnesses : [],
      description: conditionsDescription || 'No conditions specified',
      conditions: activeConditions,
      owner: localStorage.getItem('trustchain_user') || 'guest',
      status: 'Pending',
      uploadDate: toIndiaDateString(),
      executor: formData.executorName,
      executorEmail: formData.executorEmail,
      executorAddress: formData.executorAddress,
      beneficiaries: formData.beneficiaries,
      nominees: formData.nominees,
      assets: formData.assets,
      amountEth: '0.01',
      createdAt: toIndiaIsoString(),
      ...(releaseTime ? { releaseTime } : {})
    };

    setCreating(true);
    try {
      const res = await axios.post(
        `${API_BASE}/create-will`,
        newWill,
        { headers: { 'x-api-key': 'trustchain_dummy_key' } }
      );

      const blockchain = res.data?.blockchain || {};
      const createdWill = {
        ...newWill,
        status: blockchain.executed ? 'Successful' : (blockchain.revoked ? 'Revoked' : 'Pending'),
        blockchain,
        metadataCid: res.data?.metadataCid || null,
        contractAddress: res.data?.contractAddress || null,
        ownerAddress: res.data?.ownerAddress || null,
      };
      const existingDocs = JSON.parse(localStorage.getItem('trustchain_documents') || '[]');
      localStorage.setItem('trustchain_documents', JSON.stringify([...existingDocs, createdWill]));

      alert(res.data?.message || 'Digital Will created successfully! Status: Pending.');
      setCurrentStep(0);
      setFormData({
        willName: '',
        testatorName: '',
        testatorGuardianName: '',
        testatorAge: '',
        testatorAddress: '',
        religion: '',
        dob: '',
        place: '',
        testatorSignature: '',
        witnesses: [{ name: '', address: '', signature: '' }],
        conditions: [],
        executorName: '',
        executorEmail: '',
        executorAddress: '',
        beneficiaries: [],
        nominees: [],
        assets: []
      });
    } catch (err) {
      console.error('Create will error', err);
      const backendMessage = err?.response?.data?.message;
      alert(backendMessage || 'Could not create will on blockchain.');
    } finally {
      setCreating(false);
    }
  };

  const CurrentComponent = steps[currentStep].component;

  if (isLoading) {
    return (
      <div className="page create-will-container">
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <i className="fas fa-spinner fa-spin" style={{ fontSize: '40px', color: '#667eea' }}></i>
          <p style={{ marginTop: '20px', color: '#666' }}>Loading...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return null;
  }

  return (
    <div className="page create-will-container">
      <CurrentComponent
        userWills={userWills}
        formData={formData}
        creating={creating}
        onInputChange={handleInputChange}
        onNext={handleNext}
        onPrevious={handlePrevious}
        onCancel={() => setCurrentStep(0)}
        onAddBeneficiary={addBeneficiary}
        onRemoveBeneficiary={removeBeneficiary}
        onAddAsset={addAsset}
        onRemoveAsset={removeAsset}
        onAddWitness={addWitness}
        onRemoveWitness={removeWitness}
        onUpdateWitness={updateWitness}
        onAddNominee={addNominee}
        onRemoveNominee={removeNominee}
        onCreateWill={handleCreateWill}
        onNavigate={onNavigate}
      />
    </div>
  );
}

function InitialView({ onNext, userWills }) {
  const hasWills = Array.isArray(userWills) && userWills.length > 0;

  const formatWillStatus = (status) => {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'successful' || normalized === 'executed' || normalized === 'success') return 'Successful';
    if (normalized === 'revoked') return 'Revoked';
    return 'Pending';
  };

  return (
    <div className="will-container">
      <div className="header-section">
        <h2>Smart Contract Powered</h2>
        <h2>Digital Wills</h2>
        <p>Create legally-binding digital wills with smart contracts that execute automatically based on predefined conditions.</p>
      </div>

      <div className="will-actions-section">
        <button className="new-will-btn" onClick={onNext}>
          <i className="fas fa-plus"></i>
          New Will
        </button>
      </div>

      <div className="your-wills-section">
        <h3>Your Wills</h3>
        {!hasWills ? (
          <div className="no-wills-message">
            <i className="fas fa-scroll"></i>
            <p>No wills yet</p>
            <span>Your digital wills will appear here once you create them.</span>
          </div>
        ) : (
          <div className="your-wills-list">
            {userWills.slice(0, 6).map((will) => {
              const status = formatWillStatus(will.status);
              return (
                <div key={will.id} className="your-will-card">
                  <div>
                    <p className="your-will-title">{will.name}</p>
                    <span className="your-will-meta">{will.id} • {will.uploadDate || '-'}</span>
                  </div>
                  <span className={`your-will-status ${status.toLowerCase()}`}>{status}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="create-will-info">
        <h3>Create Your Digital Will</h3>
        <p>Click the "New Will" button to start creating your blockchain-secured digital will with smart contract execution.</p>
        <button className="get-started-btn" onClick={onNext}>
          Get Started
        </button>
      </div>
    </div>
  );
}

function BasicInfo({ formData, onInputChange, onNext, onPrevious, onCancel }) {
  return (
    <div className="will-container">
      <div className="header-section">
        <h2>Basic Info</h2>
      </div>

      <div className="will-form">
        <div className="form-section">
          <h3>Basic Information</h3>
          <p>Give your digital will a name and add any special conditions.</p>

          <div className="form-group">
            <label htmlFor="willName">Will Name</label>
            <input
              type="text"
              id="willName"
              placeholder="e.g., Primary Estate Will"
              value={formData.willName}
              onChange={(e) => onInputChange('willName', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="testatorName">Name of Will Creator</label>
            <input
              type="text"
              id="testatorName"
              placeholder="Full legal name"
              value={formData.testatorName}
              onChange={(e) => onInputChange('testatorName', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="testatorGuardianName">Father/Mother/Spouse Name</label>
            <input
              type="text"
              id="testatorGuardianName"
              placeholder="Guardian name"
              value={formData.testatorGuardianName}
              onChange={(e) => onInputChange('testatorGuardianName', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="testatorAge">Age</label>
            <input
              type="number"
              id="testatorAge"
              min="0"
              placeholder="Age in years"
              value={formData.testatorAge}
              onChange={(e) => onInputChange('testatorAge', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="religion">Religion</label>
            <input
              type="text"
              id="religion"
              placeholder="Religion"
              value={formData.religion}
              onChange={(e) => onInputChange('religion', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="dob">Date of Birth</label>
            <input
              type="date"
              id="dob"
              value={formData.dob}
              onChange={(e) => onInputChange('dob', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="place">Place</label>
            <input
              type="text"
              id="place"
              placeholder="City / Place"
              value={formData.place}
              onChange={(e) => onInputChange('place', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="testatorAddress">Residential Address</label>
            <input
              type="text"
              id="testatorAddress"
              placeholder="Full residential address"
              value={formData.testatorAddress}
              onChange={(e) => onInputChange('testatorAddress', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="testatorSignature">Name or Digital Signature Text</label>
            <input
              type="text"
              id="testatorSignature"
              placeholder="Enter your full name as signature"
              value={formData.testatorSignature}
              onChange={(e) => onInputChange('testatorSignature', e.target.value)}
            />
          </div>

          <ConditionBuilder
            conditions={formData.conditions}
            onUpdate={(newConds) => onInputChange('conditions', newConds)}
          />
        </div>

        <div className="form-actions">
          <button className="cancel-btn" onClick={onCancel}>Cancel</button>
          <button className="continue-btn" onClick={onNext}>Continue</button>
        </div>
      </div>
    </div>
  );
}

function WitnessDetails({ formData, onAddWitness, onRemoveWitness, onUpdateWitness, onNext, onPrevious }) {
  const witnesses = Array.isArray(formData.witnesses) && formData.witnesses.length > 0
    ? formData.witnesses
    : [{ name: '', address: '', signature: '' }];

  return (
    <div className="will-container">
      <div className="header-section">
        <h2>Witness Details</h2>
      </div>

      <div className="will-form">
        {witnesses.map((witness, index) => (
          <div className="form-section" key={`witness-${index}`}>
            <h3>Witness {index + 1}</h3>

            <div className="form-group">
              <label htmlFor={`witnessName-${index}`}>Name</label>
              <input
                type="text"
                id={`witnessName-${index}`}
                value={witness.name || ''}
                onChange={(e) => onUpdateWitness(index, 'name', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor={`witnessAddress-${index}`}>Address</label>
              <input
                type="text"
                id={`witnessAddress-${index}`}
                value={witness.address || ''}
                onChange={(e) => onUpdateWitness(index, 'address', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor={`witnessSignature-${index}`}>Signature</label>
              <input
                type="text"
                id={`witnessSignature-${index}`}
                value={witness.signature || ''}
                onChange={(e) => onUpdateWitness(index, 'signature', e.target.value)}
              />
            </div>

            {witnesses.length > 1 && (
              <button type="button" className="remove-asset-btn" onClick={() => onRemoveWitness(index)}>
                Remove Witness
              </button>
            )}
          </div>
        ))}

        <button type="button" className="add-beneficiary-btn" onClick={onAddWitness}>
          <i className="fas fa-plus"></i>
          Add Witness
        </button>

        <div className="form-actions">
          <button className="previous-btn" onClick={onPrevious}>Previous</button>
          <button className="continue-btn" onClick={onNext}>Continue</button>
        </div>
      </div>
    </div>
  );
}

function Executor({ formData, onInputChange, onNext, onPrevious }) {
  return (
    <div className="will-container">
      <div className="header-section">
        <h2>Executor</h2>
      </div>

      <div className="will-form">
        <div className="form-section">
          <h3>Assign Executor</h3>
          <p>The executor will manage the distribution of your digital assets.</p>

          <div className="form-group">
            <label htmlFor="executorName">Executor Name</label>
            <input
              type="text"
              id="executorName"
              placeholder="Full legal name"
              value={formData.executorName}
              onChange={(e) => onInputChange('executorName', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="executorEmail">Executor Email</label>
            <input
              type="email"
              id="executorEmail"
              placeholder="email@example.com"
              value={formData.executorEmail}
              onChange={(e) => onInputChange('executorEmail', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="executorAddress">Executor Wallet Address (for blockchain)</label>
            <input
              type="text"
              id="executorAddress"
              placeholder="0x..."
              value={formData.executorAddress}
              onChange={(e) => onInputChange('executorAddress', e.target.value)}
            />
          </div>
        </div>

        <div className="form-actions">
          <button className="previous-btn" onClick={onPrevious}>Previous</button>
          <button className="continue-btn" onClick={onNext}>Continue</button>
        </div>
      </div>
    </div>
  );
}

function Beneficiaries({ formData, onAddBeneficiary, onRemoveBeneficiary, onAddNominee, onRemoveNominee, onNext, onPrevious }) {
  const [newBeneficiary, setNewBeneficiary] = useState({ name: '', email: '', walletAddress: '', share: '' });
  const [newNominee, setNewNominee] = useState({ name: '', email: '', relation: '', walletAddress: '' });
  const deathConditionSelected = Array.isArray(formData.conditions) && formData.conditions.some((c) => c?.type === 'Death');

  const handleAdd = () => {
    if (!newBeneficiary.name || !newBeneficiary.email || !newBeneficiary.share) {
      alert('Beneficiary name, email, share, and wallet address are required.');
      return;
    }

    if (!isValidEvmAddress(newBeneficiary.walletAddress)) {
      alert('Please enter a valid beneficiary wallet address.');
      return;
    }

    const share = Number(newBeneficiary.share);
    if (!Number.isFinite(share) || share <= 0 || share > 100) {
      alert('Beneficiary share must be a number between 0 and 100.');
      return;
    }

    onAddBeneficiary({ ...newBeneficiary, share });
    setNewBeneficiary({ name: '', email: '', walletAddress: '', share: '' });
  };

  const handleAddNominee = () => {
    if (!newNominee.name || !newNominee.email) {
      alert('Nominee name and email are required.');
      return;
    }
    if (!EMAIL_REGEX.test(newNominee.email)) {
      alert('Please enter a valid nominee email.');
      return;
    }
    if (newNominee.walletAddress && !isValidEvmAddress(newNominee.walletAddress)) {
      alert('Please enter a valid nominee wallet address.');
      return;
    }

    onAddNominee({ ...newNominee });
    setNewNominee({ name: '', email: '', relation: '', walletAddress: '' });
  };

  return (
    <div className="will-container">
      <div className="header-section">
        <h2>Beneficiaries</h2>
      </div>

      <div className="will-form">
        <div className="form-section">
          <h3>Add Beneficiaries</h3>
          <p>Specify who will receive your digital assets and their share.</p>

          <div className="form-group">
            <label htmlFor="beneficiaryName"><i className="fas fa-user"></i> Beneficiary name</label>
            <input
              type="text"
              id="beneficiaryName"
              value={newBeneficiary.name}
              onChange={(e) => setNewBeneficiary(prev => ({ ...prev, name: e.target.value }))}
            />
          </div>

          <div className="form-group">
            <label htmlFor="beneficiaryEmail"><i className="fas fa-envelope"></i> Email</label>
            <input
              type="email"
              id="beneficiaryEmail"
              value={newBeneficiary.email}
              onChange={(e) => setNewBeneficiary(prev => ({ ...prev, email: e.target.value }))}
            />
          </div>

          <div className="form-group">
            <label htmlFor="beneficiaryShare"><i className="fas fa-percent"></i> Share %</label>
            <input
              type="number"
              id="beneficiaryShare"
              min="0"
              max="100"
              value={newBeneficiary.share}
              onChange={(e) => setNewBeneficiary(prev => ({ ...prev, share: e.target.value }))}
            />
          </div>

          <div className="form-group">
            <label htmlFor="beneficiaryAddress"><i className="fas fa-wallet"></i> Wallet address (for blockchain)</label>
            <input
              type="text"
              id="beneficiaryAddress"
              placeholder="0x..."
              value={newBeneficiary.walletAddress}
              onChange={(e) => setNewBeneficiary(prev => ({ ...prev, walletAddress: e.target.value }))}
            />
          </div>

          <button className="add-beneficiary-btn" onClick={handleAdd}>
            <i className="fas fa-plus"></i>
            Add Beneficiary
          </button>
        </div>

        {formData.beneficiaries.length > 0 && (
          <div className="beneficiaries-list">
            <h4>Added Beneficiaries</h4>
            {formData.beneficiaries.map((beneficiary, index) => (
              <div key={index} className="beneficiary-item">
                <span>{beneficiary.name} - {beneficiary.email} - {beneficiary.share}% {beneficiary.walletAddress ? `- ${beneficiary.walletAddress}` : ''}</span>
                <button onClick={() => onRemoveBeneficiary(index)}>Remove</button>
              </div>
            ))}
          </div>
        )}

        {deathConditionSelected && (
          <>
            <div className="form-section" style={{ marginTop: '16px' }}>
              <h3>Add Nominees (Death Condition)</h3>
              <p>Nominees will be included in death-verification and final release email flow.</p>

              <div className="form-group">
                <label htmlFor="nomineeName"><i className="fas fa-user-tag"></i> Nominee name</label>
                <input
                  type="text"
                  id="nomineeName"
                  value={newNominee.name}
                  onChange={(e) => setNewNominee(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label htmlFor="nomineeEmail"><i className="fas fa-envelope"></i> Nominee email</label>
                <input
                  type="email"
                  id="nomineeEmail"
                  value={newNominee.email}
                  onChange={(e) => setNewNominee(prev => ({ ...prev, email: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label htmlFor="nomineeRelation"><i className="fas fa-people-arrows"></i> Relation</label>
                <input
                  type="text"
                  id="nomineeRelation"
                  value={newNominee.relation}
                  onChange={(e) => setNewNominee(prev => ({ ...prev, relation: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label htmlFor="nomineeWallet"><i className="fas fa-wallet"></i> Wallet address (optional)</label>
                <input
                  type="text"
                  id="nomineeWallet"
                  placeholder="0x..."
                  value={newNominee.walletAddress}
                  onChange={(e) => setNewNominee(prev => ({ ...prev, walletAddress: e.target.value }))}
                />
              </div>

              <button className="add-beneficiary-btn" onClick={handleAddNominee}>
                <i className="fas fa-plus"></i>
                Add Nominee
              </button>
            </div>

            {formData.nominees.length > 0 && (
              <div className="beneficiaries-list">
                <h4>Added Nominees</h4>
                {formData.nominees.map((nominee, index) => (
                  <div key={index} className="beneficiary-item">
                    <span>{nominee.name} - {nominee.email} {nominee.relation ? `- ${nominee.relation}` : ''} {nominee.walletAddress ? `- ${nominee.walletAddress}` : ''}</span>
                    <button onClick={() => onRemoveNominee(index)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="form-actions">
          <button className="previous-btn" onClick={onPrevious}>Previous</button>
          <button className="continue-btn" onClick={onNext}>Continue</button>
        </div>
      </div>
    </div>
  );
}

function Assets({ formData, onAddAsset, onRemoveAsset, onNext, onPrevious }) {
  const [newAsset, setNewAsset] = useState({ type: '', description: '', value: '' });

  const assetTypes = [
    'Real Estate',
    'Bank Accounts',
    'Investments',
    'Cryptocurrency',
    'Personal Property',
    'Digital Assets',
    'Vehicles',
    'Jewelry',
    'Collectibles',
    'Business Interests',
    'Insurance Policies',
    'Retirement Accounts',
    'Intellectual Property',
    'Other'
  ];

  const handleAdd = () => {
    if (newAsset.type && newAsset.description && newAsset.value) {
      onAddAsset(newAsset);
      setNewAsset({ type: '', description: '', value: '' });
    }
  };

  return (
    <div className="will-container">
      <div className="header-section">
        <h2>Assets</h2>
      </div>

      <div className="will-form">
        <div className="form-section">
          <h3>Define Assets</h3>
          <p>List the digital and physical assets to be included in this will.</p>

          <div className="form-group">
            <label htmlFor="assetType"><i className="fas fa-list"></i> Select type</label>
            <select
              id="assetType"
              value={newAsset.type}
              onChange={(e) => setNewAsset(prev => ({ ...prev, type: e.target.value }))}
            >
              <option value="">Select asset type</option>
              {assetTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="assetDescription"><i className="fas fa-file-alt"></i> Description</label>
            <input
              type="text"
              id="assetDescription"
              placeholder="Describe the asset"
              value={newAsset.description}
              onChange={(e) => setNewAsset(prev => ({ ...prev, description: e.target.value }))}
            />
          </div>

          <div className="form-group">
            <label htmlFor="assetValue"><i className="fas fa-dollar-sign"></i> Estimated value</label>
            <input
              type="text"
              id="assetValue"
              placeholder="e.g., $100,000"
              value={newAsset.value}
              onChange={(e) => setNewAsset(prev => ({ ...prev, value: e.target.value }))}
            />
          </div>

          <button className="add-asset-btn" onClick={handleAdd}>
            <i className="fas fa-plus"></i>
            Add Asset
          </button>
        </div>

        {formData.assets.length > 0 && (
          <div className="assets-list">
            <h4>Added Assets</h4>
            {formData.assets.map((asset, index) => (
              <div key={index} className="asset-item">
                <span>{asset.type} - {asset.description} - {asset.value}</span>
                <button onClick={() => onRemoveAsset(index)}>Remove</button>
              </div>
            ))}
          </div>
        )}

        <div className="form-actions">
          <button className="previous-btn" onClick={onPrevious}>Previous</button>
          <button className="continue-btn" onClick={onNext}>Continue</button>
        </div>
      </div>
    </div>
  );
}

function Review({ formData, creating, onPrevious, onCreateWill }) {
  return (
    <div className="will-container">
      <div className="header-section">
        <h2>Review</h2>
      </div>

      <div className="will-form">
        <div className="form-section">
          <h3>Review & Create</h3>
          <p>Review your digital will details before creating the smart contract.</p>

          <div className="review-item">
            <strong>Will Name</strong>
            <span>{formData.willName || 'Not specified'}</span>
          </div>

          <div className="review-item">
            <strong>Testator Details</strong>
            <span>
              {formData.testatorName || 'Not specified'}
              {formData.testatorAge ? `, Age ${formData.testatorAge}` : ''}
              {formData.religion ? `, ${formData.religion}` : ''}
            </span>
            <span>{formData.testatorAddress || 'Address not specified'}</span>
          </div>

          <div className="review-item">
            <strong>Execution Conditions</strong>
            {formData.conditions.filter(c => c.type).length > 0 ? (
              <ul className="review-conditions-list">
                {formData.conditions.filter(c => c.type).map((c, i) => (
                  <li key={i}>
                    {c.type === 'Time' && `⏰ Time-based: Execute after ${formatIndiaDateTime(c.value)}`}
                    {c.type === 'Age' && (() => {
                      const { dob, currentAge, targetAge } = extractAgeConditionFields(c);
                      const ageReleaseTime = computeAgeReleaseTime(dob, targetAge);
                      return ageReleaseTime
                        ? `🎂 Age-based: Execute when beneficiary turns ${targetAge} (DOB ${dob}, present age ${currentAge}) on ${formatIndiaDateTime(ageReleaseTime * 1000)}`
                        : `🎂 Age-based: Execute when beneficiary turns ${targetAge} (DOB ${dob}, present age ${currentAge})`;
                    })()}
                    {c.type === 'Death' && '🕊 Death: Execute upon verified proof of death'}
                  </li>
                ))}
              </ul>
            ) : (
              <span>No conditions set (default 24-hour release)</span>
            )}
          </div>

          <div className="review-item">
            <strong>Executor</strong>
            <span>{formData.executorName || 'Not specified'} {formData.executorAddress ? `(${formData.executorAddress})` : ''}</span>
          </div>

          <div className="review-item">
            <strong>Beneficiaries</strong>
            {formData.beneficiaries.length > 0 ? (
              <ul>
                {formData.beneficiaries.map((b, i) => (
                  <li key={i}>{b.name} ({b.share}%) {b.walletAddress ? `- ${b.walletAddress}` : ''}</li>
                ))}
              </ul>
            ) : (
              <span>No beneficiaries added</span>
            )}
          </div>

          {Array.isArray(formData.conditions) && formData.conditions.some((c) => c?.type === 'Death') && (
            <div className="review-item">
              <strong>Nominees</strong>
              {formData.nominees.length > 0 ? (
                <ul>
                  {formData.nominees.map((n, i) => (
                    <li key={i}>{n.name} ({n.email}) {n.relation ? `- ${n.relation}` : ''} {n.walletAddress ? `- ${n.walletAddress}` : ''}</li>
                  ))}
                </ul>
              ) : (
                <span>No nominees added</span>
              )}
            </div>
          )}

          <div className="review-item">
            <strong>Assets</strong>
            {formData.assets.length > 0 ? (
              <ul>
                {formData.assets.map((a, i) => (
                  <li key={i}>{a.type}: {a.description} ({a.value})</li>
                ))}
              </ul>
            ) : (
              <span>No assets added</span>
            )}
          </div>

          <div className="review-item">
            <strong>Witnesses</strong>
            <ul>
              {(Array.isArray(formData.witnesses) && formData.witnesses.length > 0 ? formData.witnesses : [{ name: '', address: '', signature: '' }]).map((w, i) => (
                <li key={`review-witness-${i}`}>Witness {i + 1}: {w?.name || 'Not specified'} {w?.address ? `- ${w.address}` : ''}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="form-actions">
          <button className="previous-btn" onClick={onPrevious}>Previous</button>
          <button className="create-contract-btn" onClick={onCreateWill} disabled={creating}>
            {creating ? 'Creating...' : 'Create Smart Contract'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Condition Builder ──────────────────────────────────────────────────────

const CONDITION_TYPE_OPTIONS = [
  { value: 'Time',       label: '⏰ Time-Based (Date & Time)' },
  { value: 'Age',        label: '🎂 Age-Based (Beneficiary Age)' },
  { value: 'Death',      label: '🕊 Death Verification' },
];

function ConditionFields({ condition, onChange }) {
  if (!condition.type) return null;

  if (condition.type === 'Time') {
    return (
      <div className="condition-detail">
        <label><i className="fas fa-calendar-alt"></i> Execute After (Date &amp; Time)</label>
        <input
          type="datetime-local"
          value={condition.value || ''}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
        />
        <p className="condition-hint">The will executes automatically when this date/time is reached.</p>
      </div>
    );
  }

  if (condition.type === 'Age') {
    const ageFields = extractAgeConditionFields(condition);
    const currentAge = ageFields.dob ? calculateCurrentAge(ageFields.dob) : null;

    return (
      <div className="condition-detail">
        <label><i className="fas fa-id-card"></i> Beneficiary DOB</label>
        <input
          type="date"
          value={ageFields.dob}
          onChange={(e) => onChange({
            ...condition,
            dob: e.target.value,
            value: {
              ...(typeof condition.value === 'object' && condition.value ? condition.value : {}),
              dob: e.target.value,
              currentAge: ageFields.currentAge,
              targetAge: ageFields.targetAge
            }
          })}
        />

        <label><i className="fas fa-user-clock"></i> Present Age</label>
        <input
          type="number"
          min="0"
          max="130"
          placeholder="e.g., 17"
          value={ageFields.currentAge}
          onChange={(e) => onChange({
            ...condition,
            currentAge: e.target.value,
            value: {
              ...(typeof condition.value === 'object' && condition.value ? condition.value : {}),
              dob: ageFields.dob,
              currentAge: e.target.value,
              targetAge: ageFields.targetAge
            }
          })}
        />

        <label><i className="fas fa-birthday-cake"></i> Trigger At Age (years)</label>
        <input
          type="number"
          min="1"
          max="120"
          placeholder="e.g., 18"
          value={ageFields.targetAge}
          onChange={(e) => onChange({
            ...condition,
            targetAge: e.target.value,
            value: {
              ...(typeof condition.value === 'object' && condition.value ? condition.value : {}),
              dob: ageFields.dob,
              currentAge: ageFields.currentAge,
              targetAge: e.target.value
            }
          })}
        />
        <p className="condition-hint">
          Will releases on the beneficiary's birthday when they reach this age.
          {currentAge !== null ? ` Current age from DOB is ${currentAge}.` : ''}
        </p>
      </div>
    );
  }

  if (condition.type === 'Death') {
    return (
      <div className="condition-detail condition-info-box">
        <i className="fas fa-dove"></i>
        <div>
          <strong>Death Verification</strong>
          <p>This will executes upon verified proof of death submitted by the executor. All beneficiaries are notified immediately by email.</p>
        </div>
      </div>
    );
  }

  return null;
}

function ConditionBuilder({ conditions, onUpdate }) {
  // conditions is always an array: [{ type, value }, ...]
  const isMultipleMode = conditions.length > 1 || (conditions.length === 1 && conditions[0]?._multiple);

  const handleTopLevelSelect = (selected) => {
    if (selected === 'Multiple') {
      onUpdate([{ type: '', value: '', _multiple: true }, { type: '', value: '', _multiple: true }]);
    } else if (selected === '') {
      onUpdate([]);
    } else {
      onUpdate([{ type: selected, value: '' }]);
    }
  };

  const handleConditionChange = (index, updated) => {
    const next = [...conditions];
    next[index] = { ...updated, _multiple: true };
    onUpdate(next);
  };

  const addCondition = () => {
    onUpdate([...conditions, { type: '', value: '', _multiple: true }]);
  };

  const removeCondition = (index) => {
    const next = conditions.filter((_, i) => i !== index);
    onUpdate(next.length === 0 ? [] : next);
  };

  const switchToSingle = () => {
    onUpdate([]);
  };

  const primaryType = !isMultipleMode && conditions.length === 1 ? conditions[0].type : '';

  return (
    <div className="condition-builder">
      <div className="form-group">
        <label htmlFor="conditionType">
          <i className="fas fa-cogs"></i> Execution Condition
        </label>

        {!isMultipleMode && (
          <select
            id="conditionType"
            value={primaryType || ''}
            onChange={(e) => handleTopLevelSelect(e.target.value)}
          >
            <option value="">Select Condition</option>
            {CONDITION_TYPE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
            <option value="Multiple">🔀 Multiple Conditions</option>
          </select>
        )}
      </div>

      {/* Single condition fields */}
      {!isMultipleMode && conditions.length === 1 && (
        <ConditionFields
          condition={conditions[0]}
          onChange={(updated) => onUpdate([updated])}
        />
      )}

      {/* Multiple conditions mode */}
      {isMultipleMode && (
        <div className="multiple-conditions">
          <div className="multiple-conditions-header">
            <span><i className="fas fa-layer-group"></i> Multiple Conditions</span>
            <button type="button" className="link-btn" onClick={switchToSingle}>
              Switch to Single Condition
            </button>
          </div>

          {conditions.map((cond, index) => (
            <div key={index} className="condition-entry">
              <div className="condition-entry-header">
                <span className="condition-entry-label">Condition {index + 1}</span>
                {conditions.length > 1 && (
                  <button
                    type="button"
                    className="remove-condition-btn"
                    onClick={() => removeCondition(index)}
                    title="Remove this condition"
                  >
                    <i className="fas fa-times"></i>
                  </button>
                )}
              </div>
              <div className="form-group">
                <select
                  value={cond.type || ''}
                  onChange={(e) =>
                    handleConditionChange(index, { type: e.target.value, value: '' })
                  }
                >
                  <option value="">Select Type</option>
                  {CONDITION_TYPE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <ConditionFields
                condition={cond}
                onChange={(updated) => handleConditionChange(index, updated)}
              />
            </div>
          ))}

          <button type="button" className="add-condition-btn" onClick={addCondition}>
            <i className="fas fa-plus"></i> Add Another Condition
          </button>
        </div>
      )}
    </div>
  );
}

export default CreateWill;
