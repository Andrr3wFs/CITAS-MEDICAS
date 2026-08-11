-- MySQL 8+ schema for migrating the current JSON persistence to a relational database.
CREATE TABLE roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(30) NOT NULL UNIQUE
);

INSERT INTO roles (nombre) VALUES ('ADMIN'), ('DOCTOR'), ('PACIENTE');

CREATE TABLE usuarios (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario VARCHAR(100) NOT NULL UNIQUE,
  email VARCHAR(255) NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  rol_id BIGINT UNSIGNED NOT NULL,
  estado_aprobacion ENUM('pendiente', 'aprobado', 'bloqueado') NOT NULL DEFAULT 'pendiente',
  aprobado_en DATETIME NULL,
  aprobado_por BIGINT UNSIGNED NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_usuarios_rol FOREIGN KEY (rol_id) REFERENCES roles(id),
  CONSTRAINT fk_usuarios_aprobador FOREIGN KEY (aprobado_por) REFERENCES usuarios(id)
);

CREATE TABLE perfiles_paciente (
  paciente_id BIGINT UNSIGNED PRIMARY KEY,
  telefono VARCHAR(30) NULL,
  documento VARCHAR(50) NULL UNIQUE,
  fecha_nacimiento DATE NULL,
  direccion VARCHAR(255) NULL,
  CONSTRAINT fk_perfiles_paciente_usuario FOREIGN KEY (paciente_id) REFERENCES usuarios(id)
);

CREATE TABLE citas (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  paciente_id BIGINT UNSIGNED NOT NULL,
  doctor_id BIGINT UNSIGNED NULL,
  fecha DATE NOT NULL,
  hora TIME NOT NULL,
  especialidad VARCHAR(120) NULL,
  motivo TEXT NULL,
  estado ENUM('solicitada', 'confirmada', 'reprogramada', 'rechazada') NOT NULL DEFAULT 'solicitada',
  creada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_citas_paciente FOREIGN KEY (paciente_id) REFERENCES usuarios(id),
  CONSTRAINT fk_citas_doctor FOREIGN KEY (doctor_id) REFERENCES usuarios(id),
  INDEX idx_citas_estado_fecha (estado, fecha),
  INDEX idx_citas_paciente (paciente_id),
  INDEX idx_citas_doctor_fecha (doctor_id, fecha)
);

CREATE TABLE triajes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cita_id BIGINT UNSIGNED NOT NULL UNIQUE,
  doctor_id BIGINT UNSIGNED NOT NULL,
  temperatura DECIMAL(4,1) NULL,
  presion_arterial VARCHAR(20) NULL,
  frecuencia_cardiaca SMALLINT UNSIGNED NULL,
  frecuencia_respiratoria SMALLINT UNSIGNED NULL,
  saturacion_oxigeno DECIMAL(5,2) NULL,
  peso DECIMAL(5,2) NULL,
  altura DECIMAL(5,2) NULL,
  notas TEXT NULL,
  registrado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_triajes_cita FOREIGN KEY (cita_id) REFERENCES citas(id),
  CONSTRAINT fk_triajes_doctor FOREIGN KEY (doctor_id) REFERENCES usuarios(id),
  INDEX idx_triajes_doctor (doctor_id)
);

CREATE TABLE historias_clinicas (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cita_id BIGINT UNSIGNED NOT NULL UNIQUE,
  paciente_id BIGINT UNSIGNED NOT NULL,
  doctor_id BIGINT UNSIGNED NOT NULL,
  antecedentes TEXT NULL,
  diagnostico TEXT NOT NULL,
  observaciones TEXT NULL,
  tratamiento TEXT NULL,
  indicaciones TEXT NULL,
  seguimiento TEXT NULL,
  receta TEXT NULL,
  notas_consulta TEXT NULL,
  creada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_historias_cita FOREIGN KEY (cita_id) REFERENCES citas(id),
  CONSTRAINT fk_historias_paciente FOREIGN KEY (paciente_id) REFERENCES usuarios(id),
  CONSTRAINT fk_historias_doctor FOREIGN KEY (doctor_id) REFERENCES usuarios(id),
  INDEX idx_historias_paciente (paciente_id),
  INDEX idx_historias_doctor (doctor_id)
);

CREATE VIEW metricas_atencion_doctor AS
SELECT
  doctor_id,
  COUNT(*) AS total_citas,
  SUM(estado = 'atendida') AS atendidas,
  SUM(estado IN ('solicitada', 'confirmada', 'reprogramada')) AS pendientes,
  SUM(estado = 'rechazada') AS rechazadas
FROM citas
WHERE doctor_id IS NOT NULL
GROUP BY doctor_id;

CREATE TABLE solicitudes_reprogramacion (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cita_id BIGINT UNSIGNED NOT NULL,
  paciente_id BIGINT UNSIGNED NOT NULL,
  motivo TEXT NULL,
  estado ENUM('pendiente', 'aceptada', 'rechazada') NOT NULL DEFAULT 'pendiente',
  solicitada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reprogramaciones_cita FOREIGN KEY (cita_id) REFERENCES citas(id),
  CONSTRAINT fk_reprogramaciones_paciente FOREIGN KEY (paciente_id) REFERENCES usuarios(id),
  INDEX idx_reprogramaciones_cita_estado (cita_id, estado)
);