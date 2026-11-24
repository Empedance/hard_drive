# Project Engineering Rules

- Backend: Java + Spring Boot + Maven.
- Frontend: React + TypeScript + Vite + Redux.
- Database: MySQL with Flyway migrations.
- Keep backend and frontend in separate directories.
- Follow layered architecture and use DTOs for REST APIs.
- Never hardcode credentials or secrets.
- Never expose database entities directly from controllers.
- Write tests for business logic and critical API flows.
- Run tests and builds after meaningful changes.
- Fix root causes; do not suppress errors to pass builds.
- Never claim tests passed without executing them.
- Keep README.md and implementation documentation updated.
- Ask before destructive database operations or production deployments.
