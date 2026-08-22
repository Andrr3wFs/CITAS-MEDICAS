import { useEffect, useState } from 'react'
import api from '../api'
import saludSysLogo from '../assets/hospital-cross-mark.svg'
import AuthDoctorIllustration from './AuthDoctorIllustration'

function SecurityShell({ kicker, title, children }) {
  return (
    <div className="login-wrapper system-on">
      <div className="auth-shell auth-shell-login">
        <section className="auth-login-brand" aria-label="MediCenter">
          <img src={saludSysLogo} alt="MediCenter" className="auth-login-logo" />
          <div>
            <p className="auth-login-brand-name">MediCenter</p>
            <h1>Acceso protegido</h1>
            <p>Confirma tu identidad antes de consultar información clínica.</p>
          </div>
          <AuthDoctorIllustration />
        </section>
        <section className="auth-panel auth-panel-login auth-verification-panel">
          <p className="auth-card-kicker">{kicker}</p>
          <h2>{title}</h2>
          {children}
        </section>
      </div>
    </div>
  )
}

export function PasswordChangeForm({ challenge, onSession, onRequirement, onCancel }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setMessage('')

    if (password !== confirmation) {
      setMessage('Las contraseñas no coinciden.')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await api.post('/auth/password/change', {
        challengeId: challenge.id,
        password,
      })
      onSession(response.data)
    } catch (error) {
      const responseData = error.response?.data
      if (onRequirement(responseData, challenge.username)) {
        return
      }

      const policyErrors = responseData?.passwordPolicyErrors
      setMessage(Array.isArray(policyErrors) ? policyErrors.join(' ') : responseData?.message || 'No se pudo actualizar la contraseña.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <SecurityShell kicker="Contraseña requerida" title="Actualiza tu contraseña">
      <p className="auth-verification-copy">Esta cuenta requiere una contraseña nueva antes de permitir el acceso.</p>
      {message && <p className="auth-feedback auth-feedback-error">{message}</p>}
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-field">
          <label htmlFor="password-change">Nueva contraseña</label>
          <input
            id="password-change"
            type="password"
            minLength="12"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
        <div className="auth-field">
          <label htmlFor="password-change-confirmation">Confirmar contraseña</label>
          <input
            id="password-change-confirmation"
            type="password"
            minLength="12"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />
        </div>
        <button className="auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Actualizando...' : 'Actualizar contraseña'}
        </button>
      </form>
      <button type="button" className="auth-text-link auth-verification-cancel" onClick={onCancel}>Volver al inicio de sesión</button>
    </SecurityShell>
  )
}

export function MfaEnrollmentForm({ challenge, onSession, onCancel }) {
  const [enrollment, setEnrollment] = useState(null)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [retryVersion, setRetryVersion] = useState(0)

  useEffect(() => {
    let isMounted = true

    const loadEnrollment = async () => {
      setIsLoading(true)
      setMessage('')
      setEnrollment(null)
      try {
        const response = await api.post('/auth/mfa/enrollment', { challengeId: challenge.id })
        if (isMounted) {
          setEnrollment(response.data)
        }
      } catch (error) {
        if (isMounted) {
          setMessage(error.response?.data?.message || 'No se pudo preparar MFA.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadEnrollment()
    return () => {
      isMounted = false
    }
  }, [challenge.id, retryVersion])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setMessage('')
    setIsSubmitting(true)

    try {
      const response = await api.post('/auth/mfa/confirm', { challengeId: challenge.id, code })
      onSession(response.data)
    } catch (error) {
      setMessage(error.response?.data?.message || 'No se pudo confirmar el código MFA.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <SecurityShell kicker="MFA obligatorio" title="Configura tu autenticador">
      <p className="auth-verification-copy">Escanea el código QR con tu aplicación de autenticación y confirma el código generado.</p>
      {message && <p className="auth-feedback auth-feedback-error">{message}</p>}
      {isLoading ? (
        <p className="auth-verification-copy">Preparando configuración segura...</p>
      ) : enrollment && (
        <>
          <img className="auth-mfa-qr" src={enrollment.qrCodeDataUrl} alt="Código QR para configurar MFA" />
          <p className="auth-mfa-manual-key">Clave manual: <code>{enrollment.manualEntryKey}</code></p>
          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="auth-field">
              <label htmlFor="mfa-enrollment-code">Código de autenticación</label>
              <input
                id="mfa-enrollment-code"
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
              {isSubmitting ? 'Confirmando...' : 'Activar MFA'}
            </button>
          </form>
        </>
      )}
      {!isLoading && !enrollment && (
        <button
          type="button"
          className="auth-submit"
          onClick={() => setRetryVersion((currentVersion) => currentVersion + 1)}
        >
          Reintentar configuración MFA
        </button>
      )}
      <button type="button" className="auth-text-link auth-verification-cancel" onClick={onCancel}>Volver al inicio de sesión</button>
    </SecurityShell>
  )
}

export function MfaVerificationForm({ challenge, onSession, onCancel }) {
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setMessage('')
    setIsSubmitting(true)

    try {
      const response = await api.post('/auth/mfa/verify', { challengeId: challenge.id, code })
      onSession(response.data)
    } catch (error) {
      setMessage(error.response?.data?.message || 'No se pudo verificar el código MFA.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <SecurityShell kicker="Segundo factor" title="Confirma tu identidad">
      <p className="auth-verification-copy">Ingresa el código de seis dígitos de tu aplicación de autenticación.</p>
      {message && <p className="auth-feedback auth-feedback-error">{message}</p>}
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-field">
          <label htmlFor="mfa-verification-code">Código de autenticación</label>
          <input
            id="mfa-verification-code"
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
          {isSubmitting ? 'Verificando...' : 'Verificar y acceder'}
        </button>
      </form>
      <button type="button" className="auth-text-link auth-verification-cancel" onClick={onCancel}>Volver al inicio de sesión</button>
    </SecurityShell>
  )
}