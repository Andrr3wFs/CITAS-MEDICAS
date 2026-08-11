import doctorIllustration from '../assets/doctor-illustration.svg'

export default function AuthDoctorIllustration() {
  return (
    <div className="auth-doctor-visual" aria-hidden="true">
      <span className="auth-network-line auth-network-line-one" />
      <span className="auth-network-line auth-network-line-two" />
      <span className="auth-network-node auth-network-node-one" />
      <span className="auth-network-node auth-network-node-two" />
      <span className="auth-network-node auth-network-node-three" />
      <img src={doctorIllustration} alt="" />
    </div>
  )
}