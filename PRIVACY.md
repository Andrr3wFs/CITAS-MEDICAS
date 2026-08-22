# Punto 2: Privacidad de datos

## Alcance y estado actual

Este documento define la implementacion tecnica de privacidad para MediCenters. No constituye una certificacion HIPAA o GDPR: antes de tratar datos reales se requiere una evaluacion legal, DPIA, BAA con los proveedores que procesen ePHI, DPA, procedimiento de brechas, retencion aprobada y control de acceso operativo.

El backend ya cifra los secretos TOTP con AES-256-GCM y registra auditoria de acceso clinico. Sin embargo, `Backend/src/data.json` es almacenamiento de desarrollo y queda en texto plano si no se migra. No debe utilizarse como repositorio de datos clinicos reales en produccion.

## 1. Cifrado de datos

### Reposo: base de datos y respaldos

Para produccion, migra pacientes, citas, historias clinicas, sesiones y auditoria a una base de datos administrada con estos controles:

- Cifrado del volumen, replicas y respaldos con AES-256 gestionado por el proveedor.
- Cifrado de campos de alto riesgo con AES-256-GCM antes de enviarlos a la base: historia clinica, diagnostico, triaje, documento, fecha de nacimiento, direccion, telefono y correo.
- Nonce aleatorio de 96 bits por cifrado, etiqueta GCM de 128 bits y datos autenticados adicionales (AAD) con `tenantId:recordId:field:v1`.
- Claves en KMS o HSM; no en el repositorio, imagen Docker, base de datos ni logs. Usa envelope encryption, una DEK por entorno o tenant y una KEK gestionada por KMS.
- Rotacion documentada de claves, pruebas de restauracion y separacion de claves de produccion, pruebas y desarrollo.

Patron AES-256-GCM para el adaptador de persistencia. La clave debe venir de KMS y tener exactamente 32 bytes tras codificar Base64:

```js
const crypto = require('crypto');

const getPhiKey = () => {
  const key = Buffer.from(process.env.PHI_FIELD_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw new Error('PHI_FIELD_ENCRYPTION_KEY debe tener 32 bytes.');
  return key;
};

const encryptPhi = (value, aad) => {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getPhiKey(), nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);

  return {
    version: 1,
    nonce: nonce.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
};
```

Integra ese adaptador en la capa de repositorio de la base de datos, no en el controlador HTTP. La consulta debe autorizar al usuario antes de descifrar y el valor descifrado no debe escribirse en logs, errores, colas o analitica.

### Transito: TLS 1.3

- Configura `medicenters.uk` en Railway o en el proxy perimetral con certificado valido, TLS 1.3 y redireccion HTTP a HTTPS.
- Deshabilita TLS 1.0 y 1.1; si un requisito de interoperabilidad exige TLS 1.2, documenta la excepcion y limita sus suites criptograficas.
- Activa HSTS: `Strict-Transport-Security: max-age=31536000; includeSubDomains` solo despues de comprobar todos los subdominios HTTPS.
- Limita `CORS_ALLOWED_ORIGINS` a los orígenes reales. No reflejes cualquier `Origin` cuando se usan cookies o credenciales.
- Verifica el borde con `curl --tlsv1.3 -I https://medicenters.uk` y monitoriza la fecha de vencimiento del certificado.

TLS termina en el proxy de Railway, por lo que la version de TLS no se fuerza desde Express. Debe confirmarse en la configuracion del dominio y del proveedor antes de publicar.

## 2. Datos sinteticos para desarrollo y pruebas

El repositorio incluye un generador que no lee ni copia datos reales:

```powershell
npm run data:synthetic
$env:HOSPITAL_DATA_FILE = "$PWD\Backend\data\synthetic-data.json"
npm run dev
```

El comando genera usuarios `*.demo`, una cita y una historia clinica sintetica. Se rechaza en `NODE_ENV=production` y tambien se niega a sobrescribir `Backend/src/data.json` o el archivo configurado como activo. La salida esta ignorada por Git.

Reglas operativas:

- Nunca exportar, restaurar o copiar una base de produccion en desarrollo, CI o demostraciones.
- Generar identificadores, fechas y narrativa clinica sinteticos desde cero; no aplicar solo seudonimizacion a un volcado real.
- Separar cuentas, claves, buckets, proyectos Railway y KMS por entorno.
- En CI usa `HOSPITAL_DATA_FILE` temporal, como hace `npm test`, y bloquea conexiones a bases de produccion por red y credenciales.

## 3. Auditoria y trazabilidad

`Backend/src/auditLogs.js` crea registros minimizados: actor, rol, accion, tipo e identificador interno del recurso, resultado, metadatos de solicitud y hora UTC. No guarda los valores de `before/after`, diagnosticos, tratamientos, contraseñas, tokens ni direcciones IP en claro.

Cada evento nuevo incluye `previousHash` e `integrityHash`, una cadena HMAC-SHA-256 firmada con `AUDIT_LOG_HMAC_KEY`. Las rutas de paciente, medico, administrador y citas registran una lectura exitosa por cada historia clinica entregada. Verifica la cadena con:

```powershell
$env:AUDIT_LOG_HMAC_KEY = '<clave-de-auditoria-del-entorno>'
npm run audit:verify
```

La cadena HMAC es evidencia de manipulacion, no almacenamiento inmutable por si sola: quien pueda modificar el archivo y obtener la clave podria reescribirla. Para ePHI en produccion exporta los eventos a un almacenamiento WORM o servicio de auditoria externo con retencion, control de acceso de solo anadir, copias inmutables y alertas ante fallos de verificacion. Restringe la lectura de auditorias a Seguridad, Privacidad y los roles autorizados.

Para rotar `AUDIT_LOG_HMAC_KEY`, exporta y ancla la cabeza de la cadena anterior, conserva la clave previa solo durante el periodo de verificacion aprobado y aumenta `AUDIT_LOG_KEY_ID`. Nunca borres ni alteres eventos para ocultar actividad; aplica la politica de retencion aprobada y registra cualquier correccion como un evento nuevo.

## Lista de salida a produccion

1. Configurar una `AUDIT_LOG_HMAC_KEY` exclusiva y `AUDIT_LOG_KEY_ID` en Railway.
2. Migrar ePHI de `data.json` a una base de datos con AES-256 en reposo, respaldos cifrados y control de claves KMS.
3. Confirmar TLS 1.3, HSTS y `CORS_ALLOWED_ORIGINS` en el proxy perimetral.
4. Ejecutar `npm test` y `npm run audit:verify` en un entorno aislado.
5. Validar periodicamente restauracion cifrada, revocacion de acceso, retencion, alertas de auditoria y respuesta a incidentes.