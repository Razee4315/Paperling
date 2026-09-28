# Security Policy

## Supported versions

Only the latest release of Paperling receives security fixes. Please update to the newest version before reporting an issue.

## Reporting a vulnerability

Please do not report security vulnerabilities through public GitHub issues.

Instead, use GitHub's private vulnerability reporting: go to the [Security tab](https://github.com/Razee4315/Paperling/security) of this repository and click "Report a vulnerability". This keeps the details private while we work on a fix.

When reporting, please include:

- A description of the issue and its impact
- Steps to reproduce it
- The Paperling version and operating system you tested on

You can expect an initial response within a few days. Once a fix is released, we will credit you in the release notes unless you prefer to stay anonymous.

## Scope notes

- Paperling is a local-first desktop app. It stores files on your machine and does not run any server of ours.
- AI features only talk to the model provider you configure yourself, using your own API key stored in the system keychain.
- The documentation site (`docs/`) is a static site on GitHub Pages; its dependencies never ship inside the desktop app.
