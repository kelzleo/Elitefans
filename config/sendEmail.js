// config/sendEmail.js
const Brevo = require('@getbrevo/brevo');
const keys = require('./keys');
const logger = require('../logs/logger'); // Import Winston logger at top

if (!keys.brevo || !keys.brevo.apiKey) {
  logger.error('Brevo API key is not defined');
  throw new Error('Brevo API key is not defined. Please set BREVO_API_KEY in your .env file.');
}

const apiInstance = new Brevo.TransactionalEmailsApi();
apiInstance.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, keys.brevo.apiKey);

const sendEmail = async (to, subject, html) => {
  const sendSmtpEmail = new Brevo.SendSmtpEmail();
  sendSmtpEmail.sender = { email: 'blessingf2925@gmail.com', name: 'Elitefans' };
  sendSmtpEmail.to = [{ email: to }];
  sendSmtpEmail.subject = subject;
  sendSmtpEmail.htmlContent = html;

  try {
    const info = await apiInstance.sendTransacEmail(sendSmtpEmail);
    return info;
  } catch (error) {
    logger.error(`Error sending email via Brevo: ${error.message}`);
    throw error;
  }
};

module.exports = sendEmail;