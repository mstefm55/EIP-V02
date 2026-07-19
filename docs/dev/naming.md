# Naming Conventions (V2)

Purpose: prevent naming drift across DB, backend, and frontend.

## Database (PostgreSQL)
- Use `snake_case` (lowercase only) for tables/columns/index names.
- Keep tenant key naming consistent as `tenant_id`.
- Keep timestamp naming consistent (`created_at`, `updated_at`, etc.).

## Backend (JavaScript/TypeScript)
- Use `camelCase` for variables, object fields, and function names.
- Keep mapping explicit when reading/writing DB rows.

## React/UI Components
- Use `PascalCase` for component files and exported component symbols.
- Keep engine node `type` names aligned with registered component names.

## API mapping layer
- Do not expose raw DB row naming directly to frontend contracts.
- Use explicit mapping between DB `snake_case` and API/application `camelCase`.

## Folder/file conventions
- Folders: `kebab-case`
- JS/TS utility files: `camelCase.*`
- React component files: `PascalCase.*`

## Enforcement
- Violations should be fixed in the same change where discovered.
- New modules must follow these rules from first commit.
