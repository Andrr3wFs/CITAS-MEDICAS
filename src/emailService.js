// src/emailService.js
// Email notification service using nodemailer

const nodemailer = require('nodemailer');

// Email configuration - update these with your email service credentials
const EMAIL_CONFIG = {
  service: 'gmail', // or your email service
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: process.env.EMAIL_SECURE === 'true' || false,
  auth: {
    user: process.env.EMAIL_USER || 'your-email@gmail.com',
    pass: process.env.EMAIL_PASSWORD || 'your-app-password'
  }
};

let transporter = null;

const initializeTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport(EMAIL_CONFIG);
  }
  return transporter;
};

const sendEmailToAdmins = async (adminEmails, subject, htmlContent) => {
  try {
    const transport = initializeTransporter();
    
    const mailOptions = {
      from: EMAIL_CONFIG.auth.user,
      to: adminEmails.join(', '),
      subject: subject,
      html: htmlContent
    };

    const info = await transport.sendMail(mailOptions);
    console.log('Email sent:', info.response);
    return { success: true, info };
  } catch (error) {
    console.error('Error sending email:', error);
    return { success: false, error: error.message };
  }
};

const sendNewAccessRequestNotification = async (adminEmails, requestData) => {
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1f2937;">Nueva solicitud de acceso</h2>
      <p style="color: #6b7280;">Hay una nueva solicitud de acceso pendiente de revisión.</p>
      
      <div style="background: #f9fafb; padding: 1.5rem; border-radius: 8px; margin: 1.5rem 0;">
        <p><strong>Usuario:</strong> ${requestData.usuario}</p>
        <p><strong>Solicitado el:</strong> ${new Date(requestData.requestedAt).toLocaleString('es-ES')}</p>
        <p><strong>ID de solicitud:</strong> ${requestData.id}</p>
      </div>
      
      <p style="color: #6b7280; margin: 1.5rem 0;">
        Por favor, inicia sesión en el sistema de administración para revisar y aprobar o rechazar esta solicitud.
      </p>
      
      <a href="${process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3000'}" 
         style="display: inline-block; background: #3b82f6; color: white; padding: 0.75rem 1.5rem; text-decoration: none; border-radius: 6px; margin-top: 1rem;">
        Ir al panel de administración
      </a>
      
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 2rem 0;">
      <p style="color: #9ca3af; font-size: 0.85rem;">
        Este es un mensaje automático del sistema MediCenter. No responda a este correo.
      </p>
    </div>
  `;

  return sendEmailToAdmins(adminEmails, 'Nueva solicitud de acceso - MediCenter', htmlContent);
};

const sendAccessApprovedNotification = async (userEmail, userData) => {
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #10b981;">¡Tu acceso ha sido aprobado!</h2>
      <p style="color: #6b7280;">Tu solicitud de acceso al sistema MediCenter ha sido aprobada.</p>
      
      <div style="background: #f0fdf4; padding: 1.5rem; border-radius: 8px; margin: 1.5rem 0; border-left: 4px solid #10b981;">
        <p><strong>Usuario:</strong> ${userData.usuario}</p>
        <p style="color: #6b7280; margin-top: 1rem;">Ya puedes iniciar sesión en el sistema.</p>
      </div>
      
      <a href="${process.env.LOGIN_URL || 'http://localhost:3000'}" 
         style="display: inline-block; background: #10b981; color: white; padding: 0.75rem 1.5rem; text-decoration: none; border-radius: 6px; margin-top: 1rem;">
        Ir a MediCenter
      </a>
      
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 2rem 0;">
      <p style="color: #9ca3af; font-size: 0.85rem;">
        Este es un mensaje automático del sistema MediCenter.
      </p>
    </div>
  `;

  return sendEmailToAdmins([userEmail], 'Tu acceso ha sido aprobado - MediCenter', htmlContent);
};

const sendVerificationCode = async (userEmail, code) => {
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #0f766e;">Verifica tu acceso a MediCenter</h2>
      <p style="color: #4b5563;">Tu acceso fue aprobado. Ingresa este código para activar tu cuenta:</p>
      <p style="font-size: 30px; font-weight: 700; letter-spacing: 8px; color: #0f766e; margin: 28px 0;">${code}</p>
      <p style="color: #4b5563;">El código vence en 10 minutos. No lo compartas con nadie.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 2rem 0;">
      <p style="color: #9ca3af; font-size: 0.85rem;">Este es un mensaje automático del sistema MediCenter.</p>
    </div>
  `;

  return sendEmailToAdmins([userEmail], 'Código de verificación - MediCenter', htmlContent);
};

const sendAccessRejectedNotification = async (userEmail, userData, rejectionReason) => {
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ef4444;">Tu solicitud ha sido rechazada</h2>
      <p style="color: #6b7280;">Tu solicitud de acceso al sistema MediCenter ha sido rechazada.</p>
      
      <div style="background: #fef2f2; padding: 1.5rem; border-radius: 8px; margin: 1.5rem 0; border-left: 4px solid #ef4444;">
        <p><strong>Usuario:</strong> ${userData.usuario}</p>
        <p style="margin-top: 1rem;"><strong>Razón:</strong></p>
        <p style="color: #6b7280;">${rejectionReason}</p>
      </div>
      
      <p style="color: #6b7280; margin: 1.5rem 0;">
        Si tienes preguntas sobre el rechazo, contacta al administrador del sistema.
      </p>
      
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 2rem 0;">
      <p style="color: #9ca3af; font-size: 0.85rem;">
        Este es un mensaje automático del sistema MediCenter.
      </p>
    </div>
  `;

  return sendEmailToAdmins([userEmail], 'Tu solicitud de acceso ha sido rechazada - MediCenter', htmlContent);
};

module.exports = {
  sendEmailToAdmins,
  sendNewAccessRequestNotification,
  sendAccessApprovedNotification,
  sendVerificationCode,
  sendAccessRejectedNotification,
  initializeTransporter
};
