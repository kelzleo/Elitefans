// config/sendEmail.js
const Brevo = require('@getbrevo/brevo');
const keys = require('./keys');

console.log('Loading sendEmail.js from:', __filename); // Log the file path

if (!keys.brevo || !keys.brevo.apiKey) {
  throw new Error('Brevo API key is not defined. Please set BREVO_API_KEY in your .env file.');
}

const apiInstance = new Brevo.TransactionalEmailsApi();
apiInstance.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, keys.brevo.apiKey);

const sendEmail = async (to, subject, html) => {
  console.log('Attempting to send email via Brevo...');
  const sendSmtpEmail = new Brevo.SendSmtpEmail();
  sendSmtpEmail.sender = { email: 'blessingf2925@gmail.com', name: 'Elitefans' };
  sendSmtpEmail.to = [{ email: to }];
  sendSmtpEmail.subject = subject;
  sendSmtpEmail.htmlContent = html;

  console.log('Mail options:', {
    to: to,
    subject: subject,
    html: html,
    sender: sendSmtpEmail.sender,
  });

  try {
    const startSendTime = Date.now();
    const info = await apiInstance.sendTransacEmail(sendSmtpEmail);
    const endSendTime = Date.now();
    console.log('Email sent successfully via Brevo:', info);
    console.log(`Time to send email: ${(endSendTime - startSendTime) / 1000} seconds`);
    return info;
  } catch (error) {
    console.error('Error sending email via Brevo:', error);
    console.error('Error code:', error.code);
    console.error('Error response:', error.response?.body);
    throw error;
  }
};

module.exports = sendEmail;