# Security policy

Do not report secrets or sensitive document contents in a public issue. Report suspected vulnerabilities privately to the repository owner with reproduction steps, affected endpoint, impact, and suggested containment.

Local defaults are not production credentials. Pilot deployment must provide a random session secret, TLS ingress, restricted CORS origins, least-privilege PostgreSQL/MinIO accounts, scanner health monitoring, protected backups, and separately managed credentials.
