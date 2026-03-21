import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const files = [
  'cid-storage.json',
  'verification-records.json',
  'blockchain-records.json',
  'blockchain-records-archive.json',
  'death-claims.json'
];

const uploadsDir = path.join(__dirname, 'uploads');

console.log('--- STARTING FRESH START CLEANUP ---');

// Reset JSON files
files.forEach(file => {
  const filePath = path.join(__dirname, file);
  try {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf8');
    console.log(`✓ Reset: ${file}`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`✗ Error resetting ${file}:`, err.message);
    }
  }
});

// Clear uploads folder
try {
  if (fs.existsSync(uploadsDir)) {
    const items = fs.readdirSync(uploadsDir);
    items.forEach(item => {
      const itemPath = path.join(uploadsDir, item);
      if (fs.lstatSync(itemPath).isFile()) {
        fs.unlinkSync(itemPath);
        console.log(`✓ Deleted upload: ${item}`);
      }
    });
    console.log('✓ Uploads directory cleared');
  }
} catch (err) {
  console.error('✗ Error clearing uploads:', err.message);
}

console.log('--- CLEANUP COMPLETE! ---');
