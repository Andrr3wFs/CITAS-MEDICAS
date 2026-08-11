import { useState } from "react";
import api from "./api";
import "./Login.css";

export default function RegisterForm({ onRegisterSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [isRequestPending, setIsRequestPending] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    const normalizedUsername = String(email || '').trim().toLowerCase();

    try {
      const res = await api.post("/register", {
        usuario: normalizedUsername,
        password,
      });
      
      // Check if the request is pending admin approval
      if (res.data?.status === 'pending') {
        setIsRequestPending(true);
        setMessage("✓ Solicitud enviada. El administrador revisará tu solicitud y te notificará cuando sea aprobada.");
        setEmail("");
        setPassword("");
      } else {
        setMessage("Usuario registrado correctamente. Ya puedes iniciar sesión.");
        setEmail("");
        setPassword("");
        if (onRegisterSuccess) onRegisterSuccess();
      }
    } catch (err) {
      setMessage(
        err.response?.data?.message
          || (err.request
            ? "No se pudo conectar con el servidor para registrar el usuario. Verifica que el backend este activo y que la URL del API sea correcta."
            : "Error al registrar el usuario.")
      );
    }
  };

  return (
        <section className="auth-panel auth-panel-login auth-register-pane">
          <p className="auth-card-kicker">Solicitud de acceso</p>
          <h2>Contactar administrador</h2>

          {message && (
            <p className={`auth-feedback ${isRequestPending ? "auth-feedback-success" : message.includes("correctamente") ? "auth-feedback-success" : "auth-feedback-error"}`}>
              {message}
            </p>
          )}

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="auth-field">
            <label htmlFor="register-email">Correo electrónico</label>
             <input
              id="register-email"
               type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                 placeholder="ejemplo@correo.com"
                  autoComplete="email"
                   autoCapitalize="none"
                    autoCorrect="off"
                     spellCheck={false}
                      required
                    />
            </div>

            <div className="auth-field">
              <label htmlFor="register-password">Contraseña</label>
              <div className="auth-password-field">
                <input
                  id="register-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Crea una contraseña segura"
                  required
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowPassword((currentValue) => !currentValue)}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-pressed={showPassword}
                >
                  <span className="auth-password-icon" aria-hidden="true">
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M3 4.5 19.5 21" />
                        <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
                        <path d="M9.9 5.1A11.3 11.3 0 0 1 12 4.9c5.7 0 9.5 4.5 10.5 6.1a1.9 1.9 0 0 1 0 2c-.5.8-1.8 2.5-3.8 3.9" />
                        <path d="M6.2 6.3C4 7.8 2.5 9.9 1.9 11a1.9 1.9 0 0 0 0 2C3 14.7 6.8 19.1 12 19.1c1.5 0 2.8-.3 4-.7" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M1.9 12C3 10.3 6.8 5.9 12 5.9S21 10.3 22.1 12c.2.3.2.7 0 1C21 14.7 17.2 19.1 12 19.1S3 14.7 1.9 13a.9.9 0 0 1 0-1Z" />
                        <circle cx="12" cy="12.5" r="3.2" />
                      </svg>
                    )}
                  </span>
                </button>
              </div>
            </div>

            <button className="auth-submit" type="submit" disabled={isRequestPending}>
              {isRequestPending ? "Solicitud enviada" : "Solicitar acceso"}
            </button>
          </form>

          <div className="auth-login-request">
            <span>¿Ya tienes acceso?</span>
            <button type="button" onClick={onRegisterSuccess}>Volver al login</button>
          </div>
        </section>
  );
}
