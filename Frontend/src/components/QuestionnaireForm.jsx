import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../api'

export default function QuestionnaireForm({ user }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [appointment, setAppointment] = useState(null)
  const [form, setForm] = useState({ allergies: '', medications: '', familyHistory: '', smoke: 'no', alcohol: 'no' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const res = await api.get(`/appointments/${id}`)
        if (!mounted) return
        setAppointment(res.data.appointment)
        const qRes = await api.get(`/appointments/${id}/questionnaire`)
        if (!mounted) return
        const questionnaire = qRes.data.questionnaire || { answered: false, answers: null }
        if (questionnaire.answers) setForm({ ...form, ...questionnaire.answers })
      } catch (err) {
        console.error(err)
        alert(err.response?.data?.message || 'No se pudo cargar la cita')
        navigate('/dashboard')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    return () => { mounted = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const handleChange = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post(`/appointments/${id}/questionnaire`, form)
      alert('Cuestionario guardado. Gracias.')
      navigate('/dashboard')
    } catch (err) {
      console.error(err)
      alert(err.response?.data?.message || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p>Cargando...</p>
  if (!appointment) return <p>Cita no encontrada.</p>

  return (
    <div className="questionnaire-page">
      <h2>Cuestionario pre-consulta · {appointment.nombre}</h2>
      <p>Fecha: {appointment.fecha} · Hora: {appointment.hora} · Doctor: {appointment.doctor}</p>

      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-field">
          <label>¿Tiene alergias? (describa)</label>
          <textarea value={form.allergies} onChange={(e) => handleChange('allergies', e.target.value)} rows={3} />
        </div>

        <div className="auth-field">
          <label>Medicamentos actuales</label>
          <textarea value={form.medications} onChange={(e) => handleChange('medications', e.target.value)} rows={2} />
        </div>

        <div className="auth-field">
          <label>Antecedentes familiares (diabetes, hipertensión)</label>
          <input type="text" value={form.familyHistory} onChange={(e) => handleChange('familyHistory', e.target.value)} />
        </div>

        <div className="auth-field">
          <label>¿Fuma?</label>
          <select value={form.smoke} onChange={(e) => handleChange('smoke', e.target.value)}>
            <option value="no">No</option>
            <option value="yes">Sí</option>
            <option value="occasionally">Ocasionalmente</option>
          </select>
        </div>

        <div className="auth-field">
          <label>¿Bebe alcohol?</label>
          <select value={form.alcohol} onChange={(e) => handleChange('alcohol', e.target.value)}>
            <option value="no">No</option>
            <option value="yes">Sí</option>
            <option value="occasionally">Ocasionalmente</option>
          </select>
        </div>

        <div className="auth-actions">
          <button type="button" className="auth-secondary-button" onClick={() => navigate('/dashboard')}>Cancelar</button>
          <button className="auth-submit" type="submit" disabled={saving}>{saving ? 'Guardando...' : 'Enviar cuestionario'}</button>
        </div>
      </form>
    </div>
  )
}
