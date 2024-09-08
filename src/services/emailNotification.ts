import nodemailer from 'nodemailer';

// Create a transporter object using SMTP transport
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT!, 10),
  secure: false, // Use true if you're using port 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Function to send OTP email
export const sendOTPEmail = async (email: string, otp: string) => {
  try {
    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL, // Sender email address
      to: email, // Recipient email
      subject: 'Your OTP Code',
      text: `Your verification code is ${otp}, expires in 10 minutes`,
    };

    await transporter.sendMail(mailOptions);
    console.log('OTP sent successfully to', email);
  } catch (error) {
    console.error('Failed to send OTP email', error);
    throw new Error('Could not send OTP email');
  }
};

// Function to send password change notification email
export const sendPasswordChangeNotification = async (email: string) => {
  try {
    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL, // Sender email address
      to: email, // Recipient email
      subject: 'Password Changed Successfully',
      text: 'Your password has been changed successfully. If this was not you, please contact support immediately.',
    };

    await transporter.sendMail(mailOptions);
    console.log('Password change notification sent successfully to', email);
  } catch (error) {
    console.error('Failed to send password change notification', error);
    throw new Error('Could not send password change notification');
  }
};
