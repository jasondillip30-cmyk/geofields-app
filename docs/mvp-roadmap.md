# MVP Roadmap and Future Improvements

## Phase 1 (Included Now)

- Dashboard-driven internal web app scaffold
- Module pages for operations, finance, rigs, maintenance, and reports
- Role-based UI/API authorization matrix
- Scalable Prisma schema + seed script
- Working MVP layout and visual analytics

## Phase 2 (Recommended Next)

- Real authentication and session management
- Replace mock in-memory data with Prisma-backed repositories
- Full CRUD for clients, projects, rigs, drill reports, and expenses
- File uploads for maintenance photos (S3/Cloudflare R2/Azure Blob)
- Audit trail and change history for approvals

## Phase 3 (Operational Intelligence)

- Forecast scenarios (base/optimistic/risk)
- Predictive maintenance scoring from inspections and downtime history
- Budget overrun alerts and fuel anomaly detection
- Scheduled summary generation and email/WhatsApp delivery
- Inventory/material stock integration

## Phase 4 (Enterprise Hardening)

- Multi-tenant data partitioning and policy controls
- SSO and MFA
- Data warehouse export and BI connectors
- Observability: logs, metrics, traces, uptime probes
- Disaster recovery and backup policies
