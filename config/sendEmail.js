const nodemailer = require('nodemailer');
const keys = require('./keys');

const sendEmail = async (to, subject, html) => {
    // Create a transporter using Gmail service and App Password
    const transporter = nodemailer.createTransport({
        service: 'gmail', // Using Gmail
        auth: {
            user: keys.email.user,  // Email from keys
            pass: keys.email.pass,  // App password from keys
        },
    });

    // Email options
    const mailOptions = {
        from: keys.email.user, // From address (your email)
        to, // To address (recipient email)
        subject, // Subject line
        html, // HTML body content
    };

    // Send the email and return the result
    try {
        const info = await transporter.sendMail(mailOptions);
        console.log("Email sent successfully:", info.response);
        return info;
    } catch (error) {
        console.error("Error sending email:", error);
        throw error;
    }
};

module.exports = sendEmail;
