import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api from '../api';

const CHART_COLORS = ['#0f766e', '#c2410c', '#7c3aed', '#2563eb', '#be123c', '#4d7c0f'];

export default function AdminMetricsDashboard() {
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const loadMetrics = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await api.get('/metrics/appointments');
      setMetrics(response.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No se pudieron cargar las métricas.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMetrics();
  }, []);

  if (isLoading) return <p className="metrics-status">Cargando indicadores...</p>;
  if (error) return <p className="metrics-status metrics-status-error">{error}</p>;
  if (!metrics) return null;

  return (
    <section className="admin-metrics" aria-label="Métricas de citas">
      <div className="metrics-heading">
        <div>
          <p className="metrics-eyebrow">Operación clínica</p>
          <h3>Indicadores de citas</h3>
        </div>
        <button type="button" className="metrics-refresh" onClick={loadMetrics}>Actualizar</button>
      </div>

      <div className="metrics-kpis">
        <article className="metrics-kpi metrics-kpi-noshow">
          <span>Tasa de no asistencia</span>
          <strong>{metrics.noShowRate}%</strong>
          <p>{metrics.noShow} citas aprobadas sin atención registrada</p>
        </article>
        <article className="metrics-kpi">
          <span>Citas atendidas</span>
          <strong>{metrics.attended}</strong>
          <p>Atenciones confirmadas</p>
        </article>
        <article className="metrics-kpi metrics-kpi-cancelled">
          <span>Citas canceladas</span>
          <strong>{metrics.cancelled}</strong>
          <p>Cancelaciones registradas</p>
        </article>
        <article className="metrics-kpi">
          <span>Pendientes aprobadas</span>
          <strong>{metrics.approved}</strong>
          <p>Por cerrar en la operación</p>
        </article>
      </div>

      <div className="metrics-chart-grid">
        <article className="metrics-chart-panel">
          <div className="metrics-panel-heading">
            <h4>Demanda por especialidad</h4>
            <p>Solicitudes acumuladas</p>
          </div>
          {metrics.demandBySpecialty.length ? (
            <ResponsiveContainer width="100%" height={270}>
              <PieChart>
                <Pie data={metrics.demandBySpecialty} dataKey="value" nameKey="name" innerRadius={58} outerRadius={98} paddingAngle={3}>
                  {metrics.demandBySpecialty.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="metrics-empty">Aún no hay solicitudes para analizar.</p>}
        </article>

        <article className="metrics-chart-panel">
          <div className="metrics-panel-heading">
            <h4>Atendidas vs. canceladas</h4>
            <p>Últimos siete días</p>
          </div>
          <ResponsiveContainer width="100%" height={270}>
            <BarChart data={metrics.activityByDay} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dbe5e3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: '#edf7f5' }} />
              <Legend />
              <Bar dataKey="atendidas" name="Atendidas" fill="#0f766e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="canceladas" name="Canceladas" fill="#c2410c" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </article>
      </div>
    </section>
  );
}