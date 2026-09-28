# Contributing to Paperling

Thank you for your interest in contributing to Paperling. This document provides guidelines for contributing to the project.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Create a new branch for your feature or bugfix
4. Make your changes
5. Test your changes thoroughly
6. Submit a pull request

## Development Setup

```bash
# Install dependencies
bun install

# Run in development mode
bun run tauri dev

# Build for production
bun run tauri build
```

## Code Style

- **TypeScript/React**: Follow the existing code style. Use TypeScript strict mode.
- **Rust**: Follow standard Rust conventions. Run `cargo fmt` before committing.
- **CSS**: Use Tailwind CSS utilities and CSS variables for theming.

## Security: file-system access

The Tauri `fs` plugin is granted **write-only** permissions (used by HTML/PDF
export to a path the user explicitly chooses in a save dialog). All **reads** go
through Rust commands so the boundary is enforced in Rust, not in the (untrusted)
front-end:

- `read_file` / `get_file_info` — markdown content the user explicitly opens.
- `read_image_file` — preview images, restricted to the open document's folder.

**When adding a new Tauri command that takes a path from the front-end or from
document content, you MUST validate it**: reject `..` segments, absolute paths,
and drive-letter prefixes, then `canonicalize()` and confirm the result is still
inside the expected base directory before touching the file. Never widen the
`fs:scope` to grant the webview broad read access — that scope exists only for
the dialog-driven export-write flow. See `validate_rel_path` / `read_image_file`
in `src-tauri/src/commands.rs` for the pattern.

## Commit Messages

Write clear, concise commit messages that describe what changed and why:

```
Add font size selector to settings menu

- Added Small, Medium, Large font size options
- Persists selection to localStorage
- Updates CSS variables dynamically
```

## Pull Request Process

1. Update the README.md if you add new features
2. Ensure all tests pass and there are no warnings
3. Update documentation as needed
4. Request review from maintainers

## Reporting Bugs

When reporting bugs, please include:

- Operating system and version
- Steps to reproduce the issue
- Expected behavior
- Actual behavior
- Screenshots if applicable

## Feature Requests

Feature requests are welcome. Please provide:

- Clear description of the feature
- Use case and benefits
- Any implementation ideas you have

## License

By contributing, you agree that your contributions will be licensed under the
project's [Apache License 2.0](LICENSE), per Section 5 of that license. No
separate CLA is required.

## Questions

For questions, please open an issue or contact the maintainer at saqlainrazee@gmail.com.
