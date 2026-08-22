# Seguridad de acceso

## Controles implementados

- Las cuentas con rol `doctor` o `admin` completan MFA TOTP antes de recibir una sesión.
- Las contraseñas nuevas requieren al menos 12 caracteres, mayúscula, minúscula, número y símbolo. Se rechazan contraseñas comunes y valores que incluyan el usuario o nombre de la persona.
- El backend deriva usuario y rol de la sesión validada; no usa cabeceras enviadas por el navegador para autorizar operaciones.
- Las sesiones tienen un identificador revocable y expiran tras 15 minutos sin actividad por defecto. El límite absoluto por defecto es de 8 horas.
- Al cambiar contraseña, activar MFA o cerrar sesión, se revocan las sesiones previas de la cuenta.
- Los registros públicos siempre quedan pendientes de aprobación. Un nombre de usuario ya no puede otorgar rol de médico automáticamente.

## Configuración de producción

Parte de [`.env.example`](.env.example) y establece valores aleatorios distintos para `JWT_SECRET` y `MFA_ENCRYPTION_KEY`. En producción ambos son obligatorios. Define también `BOOTSTRAP_ADMIN_PASSWORD` para una instalación sin usuarios; debe cumplir la misma política de contraseñas y no incluir `admin`.

Los límites se expresan en milisegundos mediante `SESSION_IDLE_TIMEOUT_MS`, `SESSION_ABSOLUTE_TIMEOUT_MS` y `AUTH_CHALLENGE_TIMEOUT_MS`.

Configura también una `AUDIT_LOG_HMAC_KEY` distinta para firmar la cadena de auditoría y restringe `CORS_ALLOWED_ORIGINS` a los dominios web autorizados. Consulta [PRIVACY.md](PRIVACY.md) para los controles de privacidad, cifrado, datos sintéticos y trazabilidad clínica.

## Verificación

Ejecuta `npm test` desde la raíz. La prueba crea datos temporales y verifica MFA para médicos y administradores, la política de contraseñas, el aislamiento entre pacientes, la limitación de datos por médico y la revocación de sesiones.

## Migración de cuentas existentes

Al iniciar, las cuentas sin `passwordPolicyVersion` quedan marcadas con `passwordChangeRequired`. Tras validar su contraseña vigente, deben crear una contraseña conforme a la política. Los médicos y administradores continúan con la inscripción TOTP obligatoria antes de entrar al sistema.