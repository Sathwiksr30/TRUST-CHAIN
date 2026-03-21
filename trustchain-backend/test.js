import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testUpload() {
  try {
    const filePath = path.join(__dirname, 'test.docx');
    if (!fs.existsSync(filePath)) {
      console.log('test.docx not found, making a dummy one');
      fs.writeFileSync(filePath, 'dummy content');
    }
    
    const formData = new FormData();
    formData.append('document', fs.createReadStream(filePath), 'test.docx');

    console.log('Sending request to backend...');
    const response = await axios.post('http://localhost:5000/verify', formData, {
      headers: formData.getHeaders()
    });
    console.log('✅ Response:', response.data);
  } catch (err) {
    if (err.response) {
      console.error('❌ Server Error:', err.response.status, err.response.data);
    } else {
      console.error('❌ Network Error:', err.message);
    }
  }
}

testUpload();
