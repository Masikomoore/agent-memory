# Security Policy

Agent Memory stores durable personal and project context. Treat the memory database as sensitive data.

## Reporting a vulnerability

Please do **not** open a public GitHub issue for vulnerabilities that could expose memory contents, authentication credentials, or remote access.

Use GitHub's private vulnerability reporting for this repository when available. If that channel is unavailable, open a minimal issue asking the maintainer for a private security contact without including exploit details.

## Deployment guidance

- Keep the service on loopback for single-machine use.
- Use a private network, VPN, or TLS reverse proxy for LAN/WAN access.
- Non-loopback server mode requires a Bearer token.
- Use explicit Host/Origin allowlists.
- Never commit `MEMORY_SERVER_TOKEN` or provider API keys.
- Do not send passwords, API keys, auth tokens, or secrets to `memory_capture`.
- Back up LanceDB data as sensitive information.

## Supported version

During the alpha phase, security fixes target the latest `main` branch and most recent release only.
