import { Resend } from "resend";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'TrustChain <noreply@trustchain.shop>';

async function testResendAttachment() {
  if (!RESEND_API_KEY) {
    console.error("No RESEND_API_KEY found in .env");
    return;
  }

  const resend = new Resend(RESEND_API_KEY);
  const testBuffer = Buffer.from("This is a test certificate content");
  
  try {
    console.log("Sending test email with buffer attachment...");
    const response = await resend.emails.send({
      from: EMAIL_FROM,
      to: "challasathwikreddy55@gmail.com", // From death-claims.json
      subject: "Resend Buffer Attachment Test",
      html: "<p>If you see this, the buffer attachment test worked.</p>",
      attachments: [
        {
          filename: "test-cert.pdf",
          content: testBuffer
        }
      ]
    });

    if (response.error) {
      console.error("Resend API Error:", response.error);
    } else {
      console.log("Success! ID:", response.data.id);
    }
  } catch (error) {
    console.error("Catch Error:", error.message);
  }
}

testResendAttachment();
