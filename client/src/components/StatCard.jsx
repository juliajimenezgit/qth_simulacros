export default function StatCard({ label, value, detail, icon: Icon }) {
  return (
    <article className="stat-card">
      {Icon && <Icon size={24} />}
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </article>
  );
}
