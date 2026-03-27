import axios from 'axios';

async function test() {
  console.log("Testing /create-will...");
  try {
    const res = await axios.post('http://localhost:5000/create-will', {
      id: 'WILL-TEST-123',
      testatorName: 'Test Name',
      ipfsOnly: true,
      conditions: [],
      beneficiaries: [{ name: 'Ben', email: 'ben@example.com', walletAddress: '0x1234567890123456789012345678901234567890', share: 100 }],
      witnesses: [{ name: 'Wit', address: 'Addr', signature: 'Sig' }]
    }, {
      headers: { 'x-api-key': 'trustchain_dummy_key' }
    });
    console.log("Success:", res.data);
  } catch (err) {
    console.error("Error:", err.response ? err.response.data : err.message);
  }
}
test();
