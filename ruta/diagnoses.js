const express = require('express');
const { getDatabasePool, hasDatabaseConfiguration } = require('./database');

const router = express.Router();
const MAX_RESULTS = 10;

const buildBooleanSearch = (query) => query
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .split(/\s+/)
  .filter(Boolean)
  .map((term) => `${term.replace(/[^\p{L}\p{N}.]/gu, '')}*`)
  .filter((term) => term !== '*')
  .join(' ');

router.get('/diagnosticos/buscar', async (req, res) => {
  const query = String(req.query.q || '').trim().replace(/\s+/g, ' ');

  if (query.length < 3) {
    return res.status(400).json({ success: false, message: 'El parámetro q debe tener al menos 3 caracteres' });
  }

  if (!hasDatabaseConfiguration()) {
    return res.status(503).json({ success: false, message: 'El catálogo CIE-10 no está configurado en MySQL' });
  }

  const booleanSearch = buildBooleanSearch(query);
  if (!booleanSearch) {
    return res.status(400).json({ success: false, message: 'El parámetro q no contiene términos de búsqueda válidos' });
  }

  try {
    const pool = getDatabasePool();
    const codePrefix = `${query}%`;
    const [diagnoses] = await pool.execute(
      `SELECT id, codigo, descripcion
        FROM cie10
        WHERE codigo LIKE ? COLLATE utf8mb4_0900_ai_ci
           OR MATCH(descripcion) AGAINST (? IN BOOLEAN MODE)
        ORDER BY (codigo LIKE ? COLLATE utf8mb4_0900_ai_ci) DESC,
                 MATCH(descripcion) AGAINST (? IN BOOLEAN MODE) DESC,
                 codigo ASC
        LIMIT ${MAX_RESULTS}`,
      [codePrefix, booleanSearch, codePrefix, booleanSearch]
    );

    return res.json({ success: true, diagnoses });
  } catch (error) {
    console.error('Error al buscar diagnósticos CIE-10:', error.message);
    return res.status(500).json({ success: false, message: 'No se pudo consultar el catálogo CIE-10' });
  }
});

module.exports = router;