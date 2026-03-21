import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

const outputPath = path.resolve(process.cwd(), '../public/trustchain.pdf');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const doc = new PDFDocument({ size: 'A4', margin: 50 });
const out = fs.createWriteStream(outputPath);
doc.pipe(out);

const lineGap = 3.6;
const leftX = doc.page.margins.left;
const resetX = () => {
  doc.x = leftX;
};

const section = (title) => {
  resetX();
  doc.moveDown(0.45);
  doc.font('Times-Bold').fontSize(12).text(title, leftX, doc.y, { align: 'left', lineGap });
  doc.font('Times-Roman').fontSize(11);
  doc.moveDown(0.12);
};

const para = (text) => {
  resetX();
  doc.font('Times-Roman').fontSize(11).text(text, leftX, doc.y, { align: 'left', lineGap });
  doc.moveDown(0.1);
};

const field = (label, placeholder, indent = 0) => {
  resetX();
  const x = leftX + indent;
  doc.font('Times-Roman').fontSize(11).text(`${label}: `, x, doc.y, { continued: true, lineGap });
  doc.font('Times-Bold').fontSize(11).text(placeholder, { lineGap, underline: true });
  doc.font('Times-Roman').fontSize(11);
};

resetX();
doc.font('Times-Bold').fontSize(16).text('DIGITAL WILL', { align: 'center', lineGap });
doc.moveDown(0.45);

para('I, Shri/Smt ________________________, son/daughter/wife of Shri ________________________, aged ________________________ years, resident of ________________________, by religion ________________________, born on ________________________, do hereby revoke all my previous Wills and Codicils and declare this to be my last Will and Testament made on this ________ day of ____________, 20__.');
para('I declare that I am in sound mind and good health and that this Will is made by me of my own free will and volition, without any coercion, undue influence, or pressure from any person.');

section('1. WILL DETAILS');
field('Will Name', '________________________');
field('Execution Condition', '________________________');
para('(Time-Based / Age-Based / Death Verification / Multiple Conditions)');

section('2. APPOINTMENT OF EXECUTOR');
para('I hereby appoint Shri/Smt ________________________ (Email: ________________________), as the Executor of this Will, who shall be responsible for managing and distributing my assets as per my instructions.');
field('Blockchain Wallet Address of Executor', '________________________');
para('In case the above executor is unable or unwilling to act, an alternate executor may be appointed as per legal provisions.');

section('3. BENEFICIARIES');
para('I hereby declare the following beneficiaries who shall receive my assets:');
resetX();
doc.font('Times-Bold').fontSize(12).text('Beneficiary 1', leftX, doc.y, { lineGap });
doc.font('Times-Roman').fontSize(11);
field('Name', '________________________', 16);
field('Email', '________________________', 16);
field('Share (%)', '________________________', 16);
field('Wallet Address', '________________________', 16);
para('(Additional beneficiaries may be added similarly)');

section('4. ASSET DETAILS');
para('I declare that I am the sole and absolute owner of the following assets:');
resetX();
doc.font('Times-Bold').fontSize(12).text('Asset 1', leftX, doc.y, { lineGap });
doc.font('Times-Roman').fontSize(11);
field('Type', '________________________', 16);
field('Description', '________________________', 16);
field('Estimated Value', '________________________', 16);
para('(All assets added through the system are included as part of this Will)');

section('5. DISTRIBUTION OF ASSETS');
para('All the above-mentioned assets shall be distributed among the beneficiaries as per their defined share percentages.');
para('The Executor shall ensure that:');
para('- Assets are distributed fairly according to the defined shares');
para('- Blockchain-based assets are transferred using the provided wallet addresses');
para('- Legal compliance is maintained during execution');

section('6. EXECUTION CONDITIONS');
para('This Will shall come into effect based on the following condition:');
para('- Condition 1: ________________________ - ________________________');
para('(Example: Upon death verification / On a specific date / When beneficiary reaches a certain age / Multiple conditions)');

section('7. DECLARATION OF OWNERSHIP');
para('All assets listed in this Will are self-acquired and owned by me. No other person has any right, claim, or interest in these assets.');

section('8. DIGITAL ACCESS & AUTHORIZATION');
para('I authorize the Executor to access and manage my digital and financial assets, including blockchain-based assets, using the credentials and permissions provided securely.');

section('9. SIGNATURE');
para('IN WITNESS WHEREOF, I have hereunto set my hand on this ________ day of ____________, 20__ at ________________________.');
field('Signature of Testator', '________________________', 0);

section('10. WITNESSES');
para('We hereby attest that the Testator has signed this Will in our presence and has declared it as their last Will. The Testator is of sound mind and has executed this document voluntarily.');
resetX();
doc.font('Times-Bold').fontSize(12).text('Witness 1', leftX, doc.y, { lineGap });
doc.font('Times-Roman').fontSize(11);
field('Name', '________________________', 16);
field('Address', '________________________', 16);
field('Signature', '________________________', 16);

doc.moveDown(0.4);
field('Blockchain TX', '________________________');
doc.moveDown(0.5);
resetX();
doc.font('Times-Bold').fontSize(12).text('END OF DIGITAL WILL', leftX, doc.y, { lineGap });

doc.end();

await new Promise((resolve, reject) => {
  out.on('finish', resolve);
  out.on('error', reject);
});

console.log(`Generated template PDF at ${outputPath}`);
