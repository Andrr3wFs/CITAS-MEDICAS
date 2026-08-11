import { useState, useEffect } from "react";
import api from "../api";

export default function AdminAccessRequestsPanel({ user, onClose }) {
  const [requests, setRequests] = useState([]);
  const [stats, setStats] = useState({
    pending: 0,
    approved: 0,
    rejected: 0,
    autoApproved: 0,
    total: 0
  });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending"); // pending, approved, rejected, all
  const [message, setMessage] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [selectedRequestId, setSelectedRequestId] = useState(null);

  useEffect(() => {
    fetchRequests();
    fetchStats();
    
    // Refresh every 30 seconds
    const interval = setInterval(() => {
      fetchRequests();
      fetchStats();
    }, 30000);
    
    return () => clearInterval(interval);
  }, [filter]);

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const endpoint = filter === "all" ? "all" : "pending";
      const res = await api.get(`/access-requests/${endpoint}`, {
        params: { adminUsername: user?.username }
      });

      if (filter === "all") {
        setRequests(res.data?.requests || []);
      } else {
        setRequests(res.data?.requests?.filter(r => r.status === filter) || []);
      }
    } catch (err) {
      console.error("Error fetching requests:", err);
      setMessage("Error al cargar las solicitudes");
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await api.get(`/access-requests/stats`, {
        params: { adminUsername: user?.username }
      });
      setStats(res.data?.stats || {});
    } catch (err) {
      console.error("Error fetching stats:", err);
    }
  };

  const handleApprove = async (requestId) => {
    try {
      const res = await api.post("/access-requests/approve", {
        requestId,
        adminUsername: user?.username
      });
      setMessage(res.data?.message || "Solicitud aprobada");
      setRejectionReason("");
      setSelectedRequestId(null);
      await fetchRequests();
      await fetchStats();
    } catch (err) {
      setMessage(err.response?.data?.message || "Error al aprobar solicitud");
    }
  };

  const handleReject = async (requestId) => {
    if (!rejectionReason.trim()) {
      setMessage("Debes proporcionar una razón para rechazar");
      return;
    }

    try {
      const res = await api.post("/access-requests/reject", {
        requestId,
        reason: rejectionReason,
        adminUsername: user?.username
      });
      setMessage(res.data?.message || "Solicitud rechazada");
      setRejectionReason("");
      setSelectedRequestId(null);
      await fetchRequests();
      await fetchStats();
    } catch (err) {
      setMessage(err.response?.data?.message || "Error al rechazar solicitud");
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case "pending":
        return "status-pending";
      case "approved":
        return "status-done";
      case "rejected":
        return "status-rejected";
      default:
        return "status-pending";
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case "pending":
        return "Pendiente";
      case "approved":
        return "Aprobada";
      case "rejected":
        return "Rechazada";
      default:
        return status;
    }
  };

  return (
    <div className="admin-access-panel">
      <div className="admin-access-header">
        <h3>Gestión de Solicitudes de Acceso</h3>
        <button onClick={onClose} className="btn-close">✕</button>
      </div>

      {/* Statistics Dashboard */}
      <div className="admin-stats-dashboard">
        <div className="stat-card stat-card-pending">
          <span className="stat-number">{stats.pending}</span>
          <span className="stat-label">Pendientes</span>
        </div>
        <div className="stat-card stat-card-approved">
          <span className="stat-number">{stats.approved}</span>
          <span className="stat-label">Aprobadas</span>
        </div>
        <div className="stat-card stat-card-rejected">
          <span className="stat-number">{stats.rejected}</span>
          <span className="stat-label">Rechazadas</span>
        </div>
        <div className="stat-card stat-card-auto">
          <span className="stat-number">{stats.autoApproved}</span>
          <span className="stat-label">Auto-aprobadas</span>
        </div>
      </div>

      {message && (
        <div className="admin-message">
          {message}
        </div>
      )}

      <div className="admin-access-filters">
        <button
          className={`filter-btn ${filter === "pending" ? "active" : ""}`}
          onClick={() => setFilter("pending")}
        >
          Pendientes
        </button>
        <button
          className={`filter-btn ${filter === "approved" ? "active" : ""}`}
          onClick={() => setFilter("approved")}
        >
          Aprobadas
        </button>
        <button
          className={`filter-btn ${filter === "rejected" ? "active" : ""}`}
          onClick={() => setFilter("rejected")}
        >
          Rechazadas
        </button>
        <button
          className={`filter-btn ${filter === "all" ? "active" : ""}`}
          onClick={() => setFilter("all")}
        >
          Todas
        </button>
      </div>

      {loading ? (
        <p className="admin-loading">Cargando solicitudes...</p>
      ) : requests.length === 0 ? (
        <p className="admin-empty">No hay solicitudes para mostrar</p>
      ) : (
        <div className="admin-access-table">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Fecha de Solicitud</th>
                  <th>Estado</th>
                  <th>Tipo</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td>{request.usuario}</td>
                    <td>{new Date(request.requestedAt).toLocaleDateString("es-ES")}</td>
                    <td>
                      <span className={`status-badge ${getStatusBadgeClass(request.status)}`}>
                        {getStatusText(request.status)}
                      </span>
                    </td>
                    <td>
                      {request.autoApproved ? (
                        <span className="type-badge type-auto">Auto-aprobado</span>
                      ) : (
                        <span className="type-badge type-manual">Manual</span>
                      )}
                    </td>
                    <td>
                      {request.status === "pending" && (
                        <div className="admin-actions">
                          <button
                            className="btn-approve"
                            onClick={() => handleApprove(request.id)}
                          >
                            Aprobar
                          </button>
                          <button
                            className="btn-reject-action"
                            onClick={() => setSelectedRequestId(request.id)}
                          >
                            Rechazar
                          </button>
                        </div>
                      )}
                      {request.status === "rejected" && request.rejectionReason && (
                        <span className="rejection-reason" title={request.rejectionReason}>
                          {request.rejectionReason}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedRequestId && (
        <div className="admin-modal-backdrop">
          <div className="admin-modal">
            <h4>Rechazar Solicitud</h4>
            <p>Proporciona una razón para rechazar esta solicitud de acceso:</p>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Razón del rechazo..."
              rows={4}
            />
            <div className="admin-modal-actions">
              <button
                className="btn-secondary"
                onClick={() => {
                  setSelectedRequestId(null);
                  setRejectionReason("");
                }}
              >
                Cancelar
              </button>
              <button
                className="btn-reject-action"
                onClick={() => handleReject(selectedRequestId)}
              >
                Rechazar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
