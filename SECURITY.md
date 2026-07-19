# Security Policy

## Reporting a Vulnerability

OpenShip takes security seriously. If you discover a security vulnerability, please report it privately rather than opening a public issue.

**Primary reporting channel:** GitHub Private Vulnerability Reporting at https://github.com/oblien/openship/security/advisories/new

## What to Include
- Clear description and impact
- Steps to reproduce
- Affected components and versions
- Suggested fixes

## What NOT to Do
- Do not post vulnerabilities or PoCs publicly
- Do not test on production without permission

## Scope
All OpenShip components are in scope: Managed Cloud Service, Self-Hosted Control Plane (API/dashboard/CLI), Desktop App, GitHub Integration & Webhooks, Deployment Targets, Backups & Recovery, Domains & TLS, Mail Functionality.

## Out of Scope
- Publicly reported dependency issues
- Theoretical vulnerabilities without PoC
- Self-XSS or physical access attacks
- Social engineering
- Denial of service

## Supported Versions
| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Pre-release/beta | Yes (lower priority) |
| Older versions | No |

## Response Timeline
- Acknowledgment: 5 business days
- Initial assessment: 10 business days
- Fix: depends on severity
- Disclosure: coordinated after fix

## Recognition
Reporters acknowledged in release notes with permission.
