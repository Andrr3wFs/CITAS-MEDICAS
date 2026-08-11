-- MySQL 8+: catalogo CIE-10 con comparaciones insensibles a mayusculas y tildes.
CREATE TABLE IF NOT EXISTS cie10 (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(12) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  descripcion VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  UNIQUE KEY uq_cie10_codigo (codigo),
  FULLTEXT KEY ft_cie10_descripcion (descripcion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO cie10 (codigo, descripcion) VALUES
  ('A09', 'Gastroenteritis y colitis de origen no especificado'),
  ('E11.9', 'Diabetes mellitus tipo 2 sin complicaciones'),
  ('E66.9', 'Obesidad, no especificada'),
  ('F41.9', 'Trastorno de ansiedad, no especificado'),
  ('I10', 'Hipertensión esencial primaria'),
  ('J00', 'Rinofaringitis aguda resfriado común'),
  ('J45.9', 'Asma, no especificada'),
  ('K21.9', 'Enfermedad por reflujo gastroesofágico sin esofagitis'),
  ('M54.5', 'Lumbalgia'),
  ('N39.0', 'Infección de vías urinarias, sitio no especificado'),
  ('R07.9', 'Dolor torácico, no especificado'),
  ('R10.4', 'Dolor abdominal, otros y no especificados'),
  ('R50.9', 'Fiebre, no especificada'),
  ('R51.9', 'Cefalea, no especificada')
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

-- Consulta usada por GET /api/diagnosticos/buscar?q=<texto>.
-- El prefijo de codigo utiliza uq_cie10_codigo y la descripcion usa ft_cie10_descripcion.
SELECT id, codigo, descripcion
FROM cie10
WHERE codigo LIKE CONCAT(:query, '%') COLLATE utf8mb4_0900_ai_ci
   OR MATCH(descripcion) AGAINST (:boolean_query IN BOOLEAN MODE)
ORDER BY (codigo LIKE CONCAT(:query, '%') COLLATE utf8mb4_0900_ai_ci) DESC,
         MATCH(descripcion) AGAINST (:boolean_query IN BOOLEAN MODE) DESC,
         codigo ASC
LIMIT 10;