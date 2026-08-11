import { useState, useEffect, useRef } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import api from './api'
import "./Login.css"
import DashboardLayout from './components/DashboardLayout'
import QuestionnaireForm from './components/QuestionnaireForm'
import RegisterForm from "./RegisterForm"
import saludSysLogo from './assets/hospital-cross-mark.svg'
import rightImage from './assets/right-image.png'
import { useAutoLogout } from './hooks/useAutoLogout'
import AuthDoctorIllustration from './components/AuthDoctorIllustration'

const DEMO_ACCOUNTS = [
  {
    id: 'paciente',
    label: 'Paciente',
    username: 'paciente1',
    password: '1234'
  },
  {
    id: 'doctor',
    label: 'Doctor',
    username: 'doctor1',
    password: '1234'
  },
  {
    id: 'admin',
    label: 'Admin',
    username: 'admin',
    password: '1234'
  }
]

const getDisplayName = ({ username, role, displayName }) => {
  if (role === 'admin' && ['administrador', 'administracion'].includes(String(displayName || '').trim().toLowerCase())) {
    return 'Admin'
  }

  return displayName || username || 'Paciente'
}

function App() {

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [user, setUser] = useState(null)
  const [showRegister, setShowRegister] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [authAction, setAuthAction] = useState(null)
  const [verificationCredentials, setVerificationCredentials] = useState(null)

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [user, showRegister, verificationCredentials])

  const loginWithCredentials = async ({ username: nextUsername, password: nextPassword }, nextAuthAction = 'manual') => {
    setMessage('')
    setIsLoggingIn(true)
    setAuthAction(nextAuthAction)

    const normalizedUsername = nextUsername.trim().toLowerCase()

    try {
      const res = await api.post('/login', {
        usuario: normalizedUsername,
        password: nextPassword
      })

      localStorage.setItem('token', res.data.token)
      localStorage.setItem('username', res.data.username)
      localStorage.setItem('role', res.data.role || 'paciente')

      const resolvedDisplayName = getDisplayName({
        username: res.data.username,
        role: res.data.role || 'paciente',
        displayName: res.data.displayName
      })

      localStorage.setItem('displayName', resolvedDisplayName)

      setUser({
        token: res.data.token,
        username: res.data.username,
        role: res.data.role || 'paciente',
        displayName: resolvedDisplayName
      })

      setUsername('')
      setPassword('')
    } catch (err) {
      if (err.response?.data?.verificationRequired) {
        setVerificationCredentials({
          username: err.response.data.username || normalizedUsername,
          password: nextPassword,
          resendAvailableAt: err.response.data.resendAvailableAt,
        })
        return
      }

      const nextMessage = err.response?.data?.message
        || (err.request
          ? 'No se pudo conectar con el servidor. Verifica que el backend este encendido y que la URL del API sea correcta.'
          : 'No se pudo iniciar sesión. Revisa tus datos e intenta otra vez.')
      setMessage(nextMessage)
    } finally {
      setIsLoggingIn(false)
      setAuthAction(null)
    }
  }

  // verificar token al iniciar
  useEffect(() => {
    const token = localStorage.getItem('token')
    const storedUsername = localStorage.getItem('username')
    const storedRole = localStorage.getItem('role')
    const storedDisplayName = localStorage.getItem('displayName')
    if (token) {
      const resolvedDisplayName = getDisplayName({
        username: storedUsername || 'Paciente',
        role: storedRole || 'paciente',
        displayName: storedDisplayName
      })

      setUser({
        token,
        username: storedUsername || 'Paciente',
        role: storedRole || 'paciente',
        displayName: resolvedDisplayName
      })

      localStorage.setItem('displayName', resolvedDisplayName)
    }
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    await loginWithCredentials({ username, password }, 'manual')
  }

  const handleDemoLogin = async (demoAccount) => {
    setUsername(demoAccount.username)
    setPassword(demoAccount.password)
    await loginWithCredentials(demoAccount, demoAccount.id)
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('username')
    localStorage.removeItem('role')
    localStorage.removeItem('displayName')
    setUser(null)
    setUsername('')
    setPassword('')
    setMessage('')
  }

  useAutoLogout({
    enabled: Boolean(user),
    onIdle: handleLogout,
  })

  return (
    <div className="app-container">

      <Routes>

        {/* LOGIN */}
        <Route
          path="/"
          element={
            user
              ? <Navigate to="/dashboard" />
              : verificationCredentials
                ? <VerificationForm
                    credentials={verificationCredentials}
                    onVerified={async () => {
                      const credentials = verificationCredentials
                      setVerificationCredentials(null)
                      await loginWithCredentials(credentials)
                    }}
                    onCancel={() => setVerificationCredentials(null)}
                  />
                : <AuthPortal
                    showRegister={showRegister}
                    onShowRegister={() => setShowRegister(true)}
                    onShowLogin={() => setShowRegister(false)}
                    loginProps={{ username, setUsername, password, setPassword, handleLogin, handleDemoLogin, authAction, isLoggingIn, message }}
                  />
          }
        />

        {/* DASHBOARD */}
        <Route
          path="/dashboard"
          element={
            user
              ? <DashboardLayout user={user} handleLogout={handleLogout} />
              : <Navigate to="/" />
          }
        />
        <Route
          path="/questionnaire/:id"
          element={
            user
              ? <QuestionnaireForm user={user} />
              : <Navigate to="/" />
          }
        />

      </Routes>

    </div>
  )
}

function AuthPortal({ showRegister, onShowRegister, onShowLogin, loginProps }) {
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [isPulseAudioEnabled, setIsPulseAudioEnabled] = useState(false)
  const audioContextRef = useRef(null)
  const pulseAudioStartedRef = useRef(false)

  useEffect(() => {
    if (!isPulseAudioEnabled) return undefined

    const playPulseTone = () => {
      const context = audioContextRef.current
      if (!context || context.state !== 'running') return

      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const now = context.currentTime

      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(880, now)
      oscillator.frequency.exponentialRampToValueAtTime(660, now + 0.075)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.008)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(now)
      oscillator.stop(now + 0.12)
    }

    playPulseTone()
    const pulseInterval = window.setInterval(playPulseTone, 1600)

    return () => window.clearInterval(pulseInterval)
  }, [isPulseAudioEnabled])

  useEffect(() => () => {
    audioContextRef.current?.close().catch(() => {})
  }, [])

  const enablePulseAudio = () => {
    if (pulseAudioStartedRef.current) return

    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return

    pulseAudioStartedRef.current = true
    audioContextRef.current = new AudioContextClass()
    audioContextRef.current.resume().catch(() => {})
    setIsPulseAudioEnabled(true)
  }

  const toggleLogin = () => {
    enablePulseAudio()
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })

    setIsLoginOpen((isOpen) => {
      if (isOpen) return false

      onShowLogin()
      return true
    })
  }

  return (
    <div className="login-wrapper system-on">
      <video
        className="login-background-video"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        poster={rightImage}
      >
        <source src="https://assets.mixkit.co/videos/preview/mixkit-doctor-talking-to-a-patient-in-a-hospital-40638-large.mp4" type="video/mp4" />
      </video>
      <div className="clinical-ecg" aria-hidden="true">
        <svg viewBox="0 0 1200 180" preserveAspectRatio="none" focusable="false">
          <path className="clinical-ecg-trace" pathLength="1200" d="M0 95h52c12 0 16-13 28-13s16 13 28 13h32l12 7 12-14 16 55 18-108 18 126 15-66 13 0h34c12 0 18-18 34-18s22 18 38 18h76h52c12 0 16-13 28-13s16 13 28 13h32l12 7 12-14 16 55 18-108 18 126 15-66 13 0h34c12 0 18-18 34-18s22 18 38 18h76h52c12 0 16-13 28-13s16 13 28 13h32l12 7 12-14 16 55 18-108 18 126 15-66 13 0h34c12 0 18-18 34-18s22 18 38 18h76" />
          <path className="clinical-ecg-trail" pathLength="1200" d="M0 95h52c12 0 16-13 28-13s16 13 28 13h32l12 7 12-14 16 55 18-108 18 126 15-66 13 0h34c12 0 18-18 34-18s22 18 38 18h76h52c12 0 16-13 28-13s16 13 28 13h32l12 7 12-14 16 55 18-108 18 126 15-66 13 0h34c12 0 18-18 34-18s22 18 38 18h76h52c12 0 16-13 28-13s16 13 28 13h32l12 7 12-14 16 55 18-108 18 126 15-66 13 0h34c12 0 18-18 34-18s22 18 38 18h76" />
          <circle className="clinical-ecg-dot" r="4.5">
            <animateMotion dur="4.8s" repeatCount="indefinite" path="M0 95h52c12 0 16-13 28-13s16 13 28 13h32l12 7 12-14 16 55 18-108 18 126 15-66 13 0h34c12 0 18-18 34-18s22 18 38 18h76h52c12 0 16-13 28-13s16 13 28 13h32l12 7 12-14 16 55 18-108 18 126 15-66 13 0h34c12 0 18-18 34-18s22 18 38 18h76h52c12 0 16-13 28-13s16 13 28 13h32l12 7 12-14 16 55 18-108 18 126 15-66 13 0h34c12 0 18-18 34-18s22 18 38 18h76" />
          </circle>
        </svg>
      </div>
      <span className="clinical-particle clinical-particle-one" aria-hidden="true">+</span>
      <span className="clinical-particle clinical-particle-two" aria-hidden="true" />
      <span className="clinical-particle clinical-particle-three" aria-hidden="true">+</span>
      <span className="clinical-particle clinical-particle-four" aria-hidden="true" />
      <div className={`auth-entry-intro ${isLoginOpen ? 'auth-entry-intro-hidden' : ''}`} aria-hidden={isLoginOpen}>
        <img src={saludSysLogo} alt="" className="auth-entry-intro-logo" />
        <p className="auth-entry-intro-kicker">MediCenter</p>
        <h1>Portal clínico</h1>
        <p>Gestión hospitalaria segura para pacientes y personal clínico.</p>
      </div>
      <button
        type="button"
        className={`auth-login-launcher ${isLoginOpen ? 'auth-login-launcher-close' : 'auth-login-launcher-open'}`}
        onClick={toggleLogin}
        aria-expanded={isLoginOpen}
        aria-controls="login-portal"
      >
        <LogIn aria-hidden="true" size={18} />
        <span>{isLoginOpen ? 'Ocultar acceso' : 'Entrar al portal'}</span>
      </button>
      <div
        id="login-portal"
        className={`auth-shell auth-shell-login auth-overlay-slider ${showRegister ? 'right-panel-active' : ''} ${isLoginOpen ? '' : 'auth-entry-hidden'}`}
      >
        <section className="auth-login-brand" aria-label="MediCenter">
          <span className="auth-login-logo" aria-hidden="true" />
          <div>
            <p className="auth-login-brand-name">MediCenter</p>
            <h1>{showRegister ? 'Solicitar acceso' : 'Portal clínico'}</h1>
            <p>{showRegister ? 'Completa tus datos para que Admin valide tu acceso al portal clínico.' : 'Acceso al sistema de gestión hospitalaria.'}</p>
          </div>
          <AuthDoctorIllustration />
        </section>
        <div className="auth-form-stage">
          <LoginForm {...loginProps} onShowRegister={onShowRegister} />
          <RegisterForm onRegisterSuccess={onShowLogin} />
        </div>
      </div>
    </div>
  )
}

function LoginForm({ username, setUsername, password, setPassword, handleLogin, handleDemoLogin, authAction, isLoggingIn, message, onShowRegister }) {
  const [showPassword, setShowPassword] = useState(false)
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false)
  const isManualLoginPending = isLoggingIn && authAction === 'manual'

  return (
        <section className="auth-panel auth-panel-login auth-login-pane">
          <p className="auth-card-kicker">Acceso seguro</p>
          <h2>Iniciar sesión</h2>

          {message && (
            <p className="auth-feedback auth-feedback-error">
              {message}
            </p>
          )}

          <form className="auth-form" onSubmit={handleLogin}>
            <div className="auth-field">
              <label htmlFor="login-username">Usuario</label>
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Correo o usuario"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
              />
            </div>

            <div className="auth-field">
              <label htmlFor="login-password">Contraseña</label>
              <div className="auth-password-field">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Ingresa tu contraseña"
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

            <div className="auth-inline-actions">
              <button
                type="button"
                className="auth-text-link"
                onClick={() => setShowForgotPasswordModal(true)}
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>

            <button className="auth-submit" type="submit" disabled={isLoggingIn}>
              {isManualLoginPending ? (
                <span className="auth-submit-loading">
                  <span className="auth-spinner" aria-hidden="true" />
                  Ingresando...
                </span>
              ) : (
                'Ingresar al sistema'
              )}
            </button>

          </form>

          <div className="auth-demo-panel">
            <p className="auth-demo-label">Acceso de prueba</p>
            <div className="auth-demo-grid">
              {DEMO_ACCOUNTS.map((demoAccount) => {
                const isActiveDemo = isLoggingIn && authAction === demoAccount.id

                return (
                  <button
                    key={demoAccount.id}
                    type="button"
                    className="auth-demo-button"
                    data-role={demoAccount.id}
                    onClick={() => handleDemoLogin(demoAccount)}
                    disabled={isLoggingIn}
                  >
                    <span className="auth-demo-button-label">{demoAccount.label}</span>
                    <span className="auth-demo-button-action">
                      {isActiveDemo ? 'Entrando...' : 'Entrar'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="auth-login-request">
            <span>¿Necesitas acceso?</span>
            <button type="button" onClick={onShowRegister}>Solicitar acceso</button>
          </div>

          {showForgotPasswordModal && (
            <div
              className="auth-modal-backdrop"
              role="presentation"
              onClick={() => setShowForgotPasswordModal(false)}
            >
              <div
                className="auth-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="forgot-password-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="auth-modal-header">
                  <div>
                    <p className="auth-modal-kicker">Recuperación</p>
                    <h3 id="forgot-password-title">¿Olvidaste tu contraseña?</h3>
                  </div>
                  <button
                    type="button"
                    className="auth-modal-close"
                    aria-label="Cerrar ventana"
                    onClick={() => setShowForgotPasswordModal(false)}
                  >
                    ×
                  </button>
                </div>

                <p className="auth-modal-copy">
                  Solicita el restablecimiento de tu contraseña con Admin del hospital para recuperar tu acceso.
                </p>

                <button
                  type="button"
                  className="auth-modal-action"
                  onClick={() => setShowForgotPasswordModal(false)}
                >
                  Entendido
                </button>
              </div>
            </div>
          )}
        </section>
  )
}

function VerificationForm({ credentials, onVerified, onCancel }) {
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [resendAvailableAt, setResendAvailableAt] = useState(credentials.resendAvailableAt)
  const [secondsRemaining, setSecondsRemaining] = useState(0)

  useEffect(() => {
    const updateSecondsRemaining = () => {
      const availableAt = Date.parse(resendAvailableAt || 0)
      setSecondsRemaining(Math.max(0, Math.ceil((availableAt - Date.now()) / 1000)))
    }

    updateSecondsRemaining()
    const timerId = window.setInterval(updateSecondsRemaining, 250)
    return () => window.clearInterval(timerId)
  }, [resendAvailableAt])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setMessage('')
    setIsSubmitting(true)

    try {
      await api.post('/verify-email', { usuario: credentials.username, code })
      await onVerified()
    } catch (err) {
      setMessage(err.response?.data?.message || 'No se pudo verificar el código.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResend = async () => {
    setMessage('')
    setIsResending(true)

    try {
      const response = await api.post('/resend-verification-code', { usuario: credentials.username })
      setResendAvailableAt(response.data.resendAvailableAt)
      setCode('')
      setMessage('Enviamos un nuevo código a tu correo.')
    } catch (err) {
      const retryAfterSeconds = err.response?.data?.retryAfterSeconds
      if (retryAfterSeconds) {
        setResendAvailableAt(new Date(Date.now() + retryAfterSeconds * 1000).toISOString())
      }
      setMessage(err.response?.data?.message || 'No se pudo reenviar el código.')
    } finally {
      setIsResending(false)
    }
  }

  return (
    <div className="login-wrapper system-on">
      <div className="auth-shell auth-shell-login">
        <section className="auth-login-brand" aria-label="MediCenter">
          <img src={saludSysLogo} alt="MediCenter" className="auth-login-logo" />
          <div>
            <p className="auth-login-brand-name">MediCenter</p>
            <h1>Acceso protegido</h1>
            <p>Confirma tu correo para acceder al portal clínico.</p>
          </div>
          <AuthDoctorIllustration />
        </section>

        <section className="auth-panel auth-panel-login auth-verification-panel">
          <p className="auth-card-kicker">Verificación de correo</p>
          <h2>Ingresa tu código</h2>
          <p className="auth-verification-copy">Enviamos un código de 6 dígitos a <strong>{credentials.username}</strong>.</p>

          {message && <p className={`auth-feedback ${message.includes('Enviamos') ? 'auth-feedback-success' : 'auth-feedback-error'}`}>{message}</p>}

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="auth-field">
              <label htmlFor="verification-code">Código de verificación</label>
              <input
                id="verification-code"
                className="auth-verification-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength="6"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                required
              />
            </div>

            <button className="auth-submit" type="submit" disabled={isSubmitting || code.length !== 6}>
              {isSubmitting ? 'Verificando...' : 'Verificar código'}
            </button>
          </form>

          <div className="auth-verification-resend">
            {secondsRemaining > 0 ? (
              <span>Reenviar código en {secondsRemaining}s</span>
            ) : (
              <button type="button" className="auth-text-link" onClick={handleResend} disabled={isResending}>
                {isResending ? 'Reenviando...' : 'Reenviar código'}
              </button>
            )}
          </div>
          <button type="button" className="auth-text-link auth-verification-cancel" onClick={onCancel}>Volver al inicio de sesión</button>
        </section>
      </div>
    </div>
  )
}


export default App