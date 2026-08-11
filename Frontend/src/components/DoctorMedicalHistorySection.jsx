import { useEffect, useState } from "react";
import saludSysMark from "../assets/saludsys-mark.svg";
import { findDoctorByName, findDoctorByUsername } from "../doctorDirectory";
import { cie10Catalog } from "../cie10Catalog";

const clinicalHistoryReadOnlyFields = [
  { key: "patient-name", label: "Paciente", getValue: (appointment) => appointment?.nombre || "" },
  { key: "doctor-name", label: "Doctor", getValue: (appointment) => appointment?.doctor || "" },
  { key: "date", label: "Fecha", getValue: (appointment) => appointment?.fecha || "" },
  { key: "time", label: "Hora", getValue: (appointment) => appointment?.hora || "" },
];

const clinicalHistoryEditableFields = [
  { key: "medicalHistory", label: "Historial médico", rows: 4 },
  { key: "diagnosis", label: "Diagnóstico", rows: 3, required: true },
  { key: "observations", label: "Observaciones", rows: 3 },
  { key: "treatment", label: "Tratamiento", rows: 3 },
  { key: "indications", label: "Indicaciones", rows: 3 },
  { key: "followUp", label: "Seguimiento", rows: 3 },
];

const getAppointmentDiagnosis = (appointment) =>
  appointment?.clinicalHistory?.diagnosis || appointment?.diagnostico || "";

const hasClinicalHistorySaved = (appointment) => Boolean(getAppointmentDiagnosis(appointment));

const getClinicalRecordCode = (appointment) =>
  `HC-${String(appointment?.id || 0).padStart(4, "0")}`;

const getDoctorSpecialty = (appointment, assignedDoctorName) => {
  const doctorProfile =
    findDoctorByUsername(appointment?.doctorUsername) ||
    findDoctorByName(appointment?.doctor) ||
    findDoctorByName(assignedDoctorName);

  return doctorProfile?.specialty || "Atención general";
};

const createEmptyPrescription = () => ({ medication: "", dose: "", frequency: "", duration: "" });

const parsePrescription = (value) => {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) && parsed.length ? parsed : [createEmptyPrescription()];
  } catch {
    return [createEmptyPrescription()];
  }
};

const getBmi = (weight, height) => {
  const weightValue = Number(String(weight || "").replace(",", "."));
  const heightValue = Number(String(height || "").replace(",", "."));
  const heightInMeters = heightValue > 3 ? heightValue / 100 : heightValue;
  if (!weightValue || !heightInMeters) return null;

  const value = weightValue / (heightInMeters ** 2);
  if (!Number.isFinite(value)) return null;
  const status = value < 18.5 ? "Bajo peso" : value < 25 ? "Peso normal" : value < 30 ? "Sobrepeso" : "Obesidad";
  return { value: value.toFixed(1), status };
};

export default function DoctorMedicalHistorySection({
  assignedDoctorName,
  appointments,
  activeAppointment,
  formValues,
  formMode,
  onCreateForm,
  onViewAppointment,
  onEditAppointment,
  onCloseForm,
  onSave,
  onFieldChange,
}) {
  const pendingAppointments = appointments.filter((appointment) => !hasClinicalHistorySaved(appointment));
  const savedAppointments = appointments.filter((appointment) => hasClinicalHistorySaved(appointment));
  const isViewMode = formMode === "view";
  const activeDoctorSpecialty = getDoctorSpecialty(activeAppointment, assignedDoctorName);
  const [diagnosisQuery, setDiagnosisQuery] = useState(formValues.diagnosis || "");
  const [triageValues, setTriageValues] = useState(activeAppointment?.triage || {});
  const [prescriptions, setPrescriptions] = useState(parsePrescription(formValues.prescription));

  useEffect(() => {
    setDiagnosisQuery(formValues.diagnosis || "");
    setTriageValues(activeAppointment?.triage || {});
    setPrescriptions(parsePrescription(formValues.prescription));
  }, [activeAppointment?.id, formValues.diagnosis, formValues.prescription]);

  const bmi = getBmi(triageValues.peso, triageValues.altura);
  const cieMatches = diagnosisQuery.trim().length < 2
    ? []
    : cie10Catalog.filter((entry) => `${entry.code} ${entry.label}`.toLowerCase().includes(diagnosisQuery.toLowerCase())).slice(0, 6);

  const updatePrescription = (index, field, value) => {
    setPrescriptions((current) => current.map((entry, entryIndex) => (
      entryIndex === index ? { ...entry, [field]: value } : entry
    )));
  };

  const handlePrintPrescription = () => {
    const items = prescriptions.filter((entry) => entry.medication.trim());
    if (!items.length) {
      window.alert("Agrega al menos un medicamento para imprimir la receta.");
      return;
    }

    const printWindow = window.open("", "_blank", "width=820,height=700");
    if (!printWindow) return;
    printWindow.document.write(`<!doctype html><html lang="es"><head><title>Receta médica</title><style>body{font-family:Arial,sans-serif;margin:38px;color:#172554}h1{margin:0 0 6px}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:10px;border-bottom:1px solid #cbd5e1;text-align:left}th{background:#ecfeff}</style></head><body><h1>Receta médica</h1><p>Paciente: ${activeAppointment?.nombre || "-"}</p><p>Doctor: ${activeAppointment?.doctor || assignedDoctorName}</p><table><thead><tr><th>Medicamento</th><th>Dosis</th><th>Frecuencia</th><th>Duración</th></tr></thead><tbody>${items.map((entry) => `<tr><td>${entry.medication}</td><td>${entry.dose}</td><td>${entry.frequency}</td><td>${entry.duration}</td></tr>`).join("")}</tbody></table></body></html>`);
    printWindow.document.close();
    printWindow.print();
  };

  const renderClinicalHeader = (eyebrow) => (
    <div className="medical-history-form-header">
      <div className="medical-history-header-stack">
        <div className="medical-history-brand-lockup">
          <div className="medical-history-brand-copy">
            <span className="medical-history-brand-name">MediCenter</span>
            <span className="medical-history-brand-tagline">Expediente hospitalario</span>
          </div>
        </div>

        <div className="medical-history-identity">
          <p className="details-eyebrow">{eyebrow}</p>
          <div className="medical-history-title-row">
            <h3>{activeAppointment?.nombre}</h3>
            <span className="medical-history-specialty-badge">{activeDoctorSpecialty}</span>
          </div>
          <p className="medical-history-record-code">{getClinicalRecordCode(activeAppointment)}</p>
        </div>
      </div>

      <button
        type="button"
        className="btn-details-close"
        onClick={onCloseForm}
      >
        x
      </button>
    </div>
  );

  const getAppointmentReason = (appointment) => appointment?.sintoma || appointment?.symptom || "Sin motivo registrado.";

const handlePrintSavedHistory = (appointment = activeAppointment) => {
    if (!appointment) return;

    const historyValues = appointment?.clinicalHistory || formValues;
    const printableFields = clinicalHistoryEditableFields
      .map(
        (field) => `
          <section class="print-block">
            <h3>${field.label}</h3>
            <p>${historyValues[field.key] || `Sin ${field.label.toLowerCase()} registrada.`}</p>
          </section>
        `
      )
      .join("");

    const doctorSpecialty = getDoctorSpecialty(appointment, assignedDoctorName);
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) {
      window.alert("No se pudo abrir la ventana de impresión.");
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="es">
        <head>
          <meta charset="UTF-8" />
          <title>Formulario clínico - ${appointment.nombre}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              color: #0f172a;
              margin: 32px;
              line-height: 1.5;
            }
            h1 {
              margin: 0 0 8px;
              font-size: 28px;
            }
            h2 {
              margin: 28px 0 12px;
              font-size: 18px;
            }
            h3 {
              margin: 0 0 8px;
              font-size: 15px;
              text-transform: uppercase;
              letter-spacing: 0.04em;
            }
            p {
              margin: 0;
              white-space: pre-wrap;
            }
            .meta-grid,
            .details-grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 16px;
            }
            .print-block {
              margin-bottom: 18px;
              padding: 14px 16px;
              border: 1px solid #cbd5e1;
              border-radius: 10px;
              break-inside: avoid;
            }
            .eyebrow {
              margin: 0 0 10px;
              color: #475569;
              font-size: 12px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.08em;
            }
            @media print {
              body {
                margin: 18px;
              }
            }
          </style>
        </head>
        <body>
          <p class="eyebrow">Formulario clínico guardado</p>
          <h1>${appointment.nombre}</h1>
          <div class="meta-grid">
            <div class="print-block"><h3>Fecha</h3><p>${appointment.fecha || "-"}</p></div>
            <div class="print-block"><h3>Hora</h3><p>${appointment.hora || "-"}</p></div>
            <div class="print-block"><h3>Doctor</h3><p>${appointment.doctor || "-"}</p></div>
            <div class="print-block"><h3>Especialidad</h3><p>${doctorSpecialty}</p></div>
          </div>
          <h2>Datos de la consulta</h2>
          <div class="details-grid">
            <div class="print-block" style="grid-column: 1 / -1;">
              <h3>Motivo de la cita</h3>
              <p>${getAppointmentReason(appointment)}</p>
            </div>
          </div>
          <h2>Historia clínica</h2>
          <div class="details-grid">
            <div class="print-block" style="grid-column: 1 / -1;">
              <h3>Diagnóstico</h3>
              <p>${historyValues?.diagnosis || "Sin diagnóstico registrado."}</p>
            </div>
          </div>
          ${printableFields}
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const renderSavedHistoryDetails = () => {
    if (!activeAppointment) return null;

    return (
      <div className="medical-history-form-card medical-history-form-card-professional">
        {renderClinicalHeader("Historia clínica archivada")}

        <div className="medical-history-meta medical-history-meta-cards">
          <span><strong>Fecha</strong>{activeAppointment.fecha}</span>
          <span><strong>Hora</strong>{activeAppointment.hora}</span>
          <span><strong>Especialidad</strong>{activeDoctorSpecialty}</span>
          <span><strong>Doctor</strong>{activeAppointment.doctor}</span>
          <span><strong>Diagnóstico</strong>{getAppointmentDiagnosis(activeAppointment) || "Sin diagnóstico"}</span>
          <span><strong>Estado</strong>Archivo clínico guardado</span>
        </div>

        <div className="clinical-history-fields">
          <div className="clinical-history-panel">
            <div className="clinical-history-panel-header">
              <h4>Resumen asistencial</h4>
              <p>Datos verificados de la consulta y contexto inicial del paciente.</p>
            </div>
            <div className="appointment-detail-grid clinical-summary-grid">
              <div className="clinical-summary-card">
              <span className="detail-label">Paciente</span>
              <p>{activeAppointment.nombre || "-"}</p>
              </div>
              <div className="clinical-summary-card">
              <span className="detail-label">Doctor</span>
              <p>{activeAppointment.doctor || "-"}</p>
              </div>
              <div className="clinical-summary-card">
              <span className="detail-label">Fecha</span>
              <p>{activeAppointment.fecha || "-"}</p>
              </div>
              <div className="clinical-summary-card">
              <span className="detail-label">Hora</span>
              <p>{activeAppointment.hora || "-"}</p>
              </div>
              <div className="appointment-detail-full clinical-summary-card">
              <span className="detail-label">Motivo</span>
              <p>{getAppointmentReason(activeAppointment)}</p>
              </div>
            </div>
          </div>

          <div className="clinical-history-panel clinical-history-panel-records">
            <div className="clinical-history-panel-header">
              <h4>Registro clínico consolidado</h4>
              <p>Contenido formal de la historia clínica emitida por el profesional.</p>
            </div>
            <div className="appointment-detail-grid clinical-history-record-grid">
              {clinicalHistoryEditableFields.map((field) => (
                <div className="appointment-detail-full clinical-summary-card clinical-summary-card-record" key={field.key}>
                  <span className="detail-label">{field.label}</span>
                  <p>{formValues[field.key] || `Sin ${field.label.toLowerCase()} registrada.`}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="medical-history-form-actions">
          <button
            type="button"
            className="btn-form-secondary"
            onClick={handlePrintSavedHistory}
          >
            Imprimir / PDF
          </button>
          <button
            type="button"
            className="btn-form-secondary"
            onClick={onCloseForm}
          >
            Cerrar
          </button>
          <button
            type="button"
            className="btn-primary-action"
            onClick={() => onEditAppointment(activeAppointment)}
          >
            Editar
          </button>
        </div>
      </div>
    );
  };

  const renderClinicalHistoryFields = () => {
    if (!activeAppointment) return null;

    return (
      <div className="clinical-history-fields">
        <div className="clinical-history-panel">
          <div className="clinical-history-panel-header">
            <h4>Identificación clínica</h4>
            <p>Información de consulta para orientar el registro asistencial.</p>
          </div>
          <div className="clinical-history-grid clinical-history-grid-readonly">
            {clinicalHistoryReadOnlyFields.map((field) => (
              <div className="appointment-field clinical-field-card clinical-field-card-readonly" key={field.key}>
                <label>{field.label}</label>
                <input type="text" value={field.getValue(activeAppointment)} readOnly />
              </div>
            ))}

            <div className="appointment-field appointment-field-full clinical-field-card clinical-field-card-readonly">
              <label>Síntoma principal</label>
              <textarea
                value={activeAppointment.sintoma || ""}
                readOnly
                rows={3}
              />
            </div>
          </div>
        </div>

        <div className="clinical-history-panel clinical-history-panel-records">
          <div className="clinical-history-panel-header">
            <h4>Registro médico</h4>
            <p>Redacta la evolución con lenguaje clínico claro y orientado al expediente.</p>
          </div>
          <div className="clinical-history-grid">
            <div className="appointment-field appointment-field-full clinical-field-card diagnosis-autocomplete">
              <label>Diagnóstico CIE-10</label>
              <input
                type="text"
                value={diagnosisQuery}
                onChange={(event) => {
                  const value = event.target.value;
                  setDiagnosisQuery(value);
                  onFieldChange("diagnosis", value);
                }}
                placeholder="Busca por código o diagnóstico"
                required
              />
              {cieMatches.length > 0 && (
                <div className="cie10-results">
                  {cieMatches.map((entry) => (
                    <button type="button" key={entry.code} onClick={() => {
                      const value = `${entry.code} - ${entry.label}`;
                      setDiagnosisQuery(value);
                      onFieldChange("diagnosis", value);
                    }}>
                      <strong>{entry.code}</strong><span>{entry.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {clinicalHistoryEditableFields.map((field) => (
              field.key === "diagnosis" ? null : (
              <div className="appointment-field appointment-field-full clinical-field-card" key={field.key}>
                <label>{field.label}</label>
                <textarea
                  value={formValues[field.key] || ""}
                  onChange={(e) => onFieldChange(field.key, e.target.value)}
                  rows={field.rows}
                  required={Boolean(field.required)}
                />
              </div>
              )
            ))}
          </div>

          <div className="clinical-subsection">
            <h4>Triaje e IMC</h4>
            <div className="vitals-grid">
              {["temperatura", "presionArterial", "frecuenciaCardiaca", "frecuenciaRespiratoria", "saturacionOxigeno", "peso", "altura"].map((field) => (
                <label key={field}>{({ temperatura: "Temperatura", presionArterial: "Presión arterial", frecuenciaCardiaca: "Frecuencia cardiaca", frecuenciaRespiratoria: "Frecuencia respiratoria", saturacionOxigeno: "Saturación O2", peso: "Peso (kg)", altura: "Talla (cm)" })[field]}
                  <input value={triageValues[field] || ""} onChange={(event) => setTriageValues((current) => ({ ...current, [field]: event.target.value }))} />
                </label>
              ))}
            </div>
            {bmi && <p className="bmi-result">IMC {bmi.value}: <strong>{bmi.status}</strong></p>}
          </div>

          <div className="clinical-subsection prescription-section">
            <div className="prescription-header"><h4>Receta / Prescripción</h4><button type="button" className="btn-form-secondary" onClick={() => setPrescriptions((current) => [...current, createEmptyPrescription()])}>Agregar medicamento</button></div>
            {prescriptions.map((entry, index) => <div className="prescription-row" key={index}>
              {[['medication', 'Fármaco'], ['dose', 'Dosis'], ['frequency', 'Frecuencia'], ['duration', 'Duración']].map(([field, label]) => <label key={field}>{label}<input value={entry[field]} onChange={(event) => updatePrescription(index, field, event.target.value)} /></label>)}
              {prescriptions.length > 1 && <button type="button" className="btn-details-close" onClick={() => setPrescriptions((current) => current.filter((_, itemIndex) => itemIndex !== index))}>x</button>}
            </div>)}
          </div>
        </div>
      </div>
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formValues.diagnosis) {
      alert("El diagnóstico es obligatorio");
      return;
    }

    onSave(e, { prescription: JSON.stringify(prescriptions), triage: triageValues });
  };

  return (
    <section className="appointments-list doctor-clinical-workspace">
      <div className="appointments-table-card doctor-clinical-board">
        <div className="doctor-clinical-hero">
          <div>
            <p className="doctor-clinical-kicker">Unidad clínica</p>
            <h3>Historias clínicas de {assignedDoctorName}</h3>
            <p>Gestiona formularios con una vista más institucional, clara y lista para expediente.</p>
          </div>
          <div className="doctor-clinical-stats">
            <article>
              <strong>{pendingAppointments.length}</strong>
              <span>Pendientes</span>
            </article>
            <article>
              <strong>{savedAppointments.length}</strong>
              <span>Archivadas</span>
            </article>
            <article>
              <strong>{appointments.length}</strong>
              <span>Total aprobadas</span>
            </article>
          </div>
        </div>

        {appointments.length === 0 ? (
          <p>No tienes citas aprobadas.</p>
        ) : (
          <div className="doctor-history-sections">
            <div className="doctor-history-section doctor-history-section-professional">
              <div className="doctor-history-section-header">
                <div>
                    <h4>
                      Formularios pendientes
                      <span className="doctor-history-count">{pendingAppointments.length}</span>
                    </h4>
                  <p>Selecciona una cita aprobada para completar su historia clínica.</p>
                </div>
              </div>

              {pendingAppointments.length === 0 ? (
                <p className="doctor-history-empty">No tienes formularios pendientes.</p>
              ) : (
                <div className="table-scroll">
                  <table className="appointments-table doctor-history-table">
                    <thead>
                      <tr>
                        <th>Paciente</th>
                        <th>Fecha</th>
                        <th>Hora</th>
                        <th>Estado</th>
                        <th>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingAppointments.map((appointment) => (
                        <tr
                          key={appointment.id}
                          className={
                            activeAppointment?.id === appointment.id
                              ? "appointment-row selected"
                              : "appointment-row"
                          }
                          onClick={() => onCreateForm(appointment)}
                        >
                          <td>{appointment.nombre}</td>
                          <td>{appointment.fecha}</td>
                          <td>{appointment.hora}</td>
                          <td>
                            <span className="status-pending">Pendiente</span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn-primary-action"
                              onClick={(e) => {
                                e.stopPropagation();
                                onCreateForm(appointment);
                              }}
                            >
                              Registrar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="doctor-history-section doctor-history-section-professional doctor-history-section-saved">
              <div className="doctor-history-section-header">
                <div>
                    <h4>
                      Formularios guardados
                      <span className="doctor-history-count doctor-history-count-saved">{savedAppointments.length}</span>
                    </h4>
                  <p>Consulta los formularios ya registrados o vuelve a editarlos.</p>
                </div>
              </div>

              {savedAppointments.length === 0 ? (
                <p className="doctor-history-empty">Todavía no has guardado formularios clínicos.</p>
              ) : (
                <div className="table-scroll">
                  <table className="appointments-table doctor-history-table">
                    <thead>
                      <tr>
                        <th>Paciente</th>
                        <th>Fecha</th>
                        <th>Hora</th>
                        <th>Especialidad</th>
                        <th>Doctor</th>
                        <th>Motivo</th>
                        <th>Diagnóstico</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {savedAppointments.map((appointment) => {
                        const diagnosis = getAppointmentDiagnosis(appointment);
                        const reason = getAppointmentReason(appointment);
                        const specialty = getDoctorSpecialty(appointment, assignedDoctorName);

                        return (
                          <tr
                            key={appointment.id}
                            className={
                              activeAppointment?.id === appointment.id
                                ? "appointment-row selected"
                                : "appointment-row"
                            }
                            onClick={() => onViewAppointment(appointment)}
                          >
                            <td>{appointment.nombre}</td>
                            <td>{appointment.fecha}</td>
                            <td>{appointment.hora}</td>
                            <td>{specialty}</td>
                            <td>{appointment.doctor}</td>
                            <td>{reason}</td>
                            <td>{diagnosis || "-"}</td>
                            <td>
                              <div className="doctor-history-actions">
                                <button
                                  type="button"
                                  className="btn-form-secondary"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onViewAppointment(appointment);
                                  }}
                                >
                                  Ver detalles
                                </button>
                                <button
                                  type="button"
                                  className="btn-primary-action"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePrintSavedHistory(appointment);
                                  }}
                                >
                                  Descargar
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {activeAppointment && isViewMode && renderSavedHistoryDetails()}

      {activeAppointment && !isViewMode && (
        <div className="medical-history-form-card medical-history-form-card-professional">
          {renderClinicalHeader("Formulario clínico")}

          <div className="medical-history-meta medical-history-meta-cards">
            <span><strong>Fecha</strong>{activeAppointment.fecha}</span>
            <span><strong>Hora</strong>{activeAppointment.hora}</span>
            <span><strong>Doctor</strong>{activeAppointment.doctor}</span>
            <span><strong>Expediente</strong>{getAppointmentDiagnosis(activeAppointment) ? "Actualización clínica" : "Nuevo registro"}</span>
          </div>

          <form className="medical-history-form" onSubmit={handleSubmit}>
            {renderClinicalHistoryFields()}

            <div className="medical-history-form-actions">
              <button type="button" className="btn-form-secondary" onClick={handlePrintPrescription}>Imprimir receta</button>
              <button
                type="button"
                className="btn-form-secondary"
                onClick={onCloseForm}
              >
                Cancelar
              </button>
              <button type="submit" className="btn-primary-action">
                {getAppointmentDiagnosis(activeAppointment)
                  ? "Actualizar historia clínica"
                  : "Guardar historia clínica"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}