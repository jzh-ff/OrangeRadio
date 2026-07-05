# OrangeRadio Code Standards

Shared by all reins. Subdomain-specific rules live in each rein's `agent.md`.

## Git workflow

- Default branch: `main`. **Never push to `main` directly.**
- Branch naming: `<reinshort>/<scope>` — e.g. `rust/fix-netease-stream`, `frontend/add-lyrics-stage`, `ai/lyric-translator`.
- Commit format: Conventional Commits (`feat:` / `fix:` / `refactor:` / `docs:` / `chore:` / `test:` / `perf:`). Body in Chinese is fine.
- Multi-crate change? Commit body lists each affected crate on its own bullet.
- Rebase before merge; no merge commits in feature branches.
- One logical change per commit. Don't mix "formatting" with "logic".

## Rust

- `edition = "2021"`, workspace `resolver = "2"`. Versions declared in `[workspace.package]` and reused via `version.workspace = true`.
- `cargo fmt --all` before commit. CI rule (when added): formatting must be clean.
- `cargo clippy --workspace --all-targets -- -D warnings` must pass before merging.
- Error handling:
  - Library crates return `Result<T, ThisError>` style — define error enums in `error.rs`.
  - Tauri command handlers map errors to `Result<T, String>` via `e.to_string()` (current convention; revisit when error ergonomics stabilize).
- Async: `tokio` runtime (`features = ["full"]`). Use `tokio::task::spawn_blocking` for blocking work (file IO, CPU-heavy parsing).
- Logging: `tracing` + `tracing-subscriber` with `env-filter`. Never `println!` for diagnostic output in library code; use `tracing::info!` / `warn!` / `debug!`.
- New `#[tauri::command]` always go in `crates/orange-tauri/src/commands.rs::register_all`. No command registration anywhere else.

## Frontend (React + TypeScript)

- `tsconfig.json: strict: true`. No `any` in new code — use `unknown` and narrow.
- React 18 + function components + hooks. No class components.
- State: Zustand stores in `frontend/src/stores/`. Cross-page state lives in a store, not in component-local `useState`.
- IPC: all Rust calls go through `invoke('command_name', args)` — don't bypass Tauri to read local files. Use `convertFileSrc()` to get `asset.localhost` URLs for `<audio>`.
- No CSS-in-JS libraries. Plain CSS files imported per-component (`Sidebar.tsx` ↔ `sidebar.css`). Co-locate.
- Build: `tsc -b && vite build` (already chained in `npm run build`). Don't run them separately in CI.

## Dependency policy

- Prefer `workspace.dependencies` for internal crates.
- Pin transitive-sensitive crates (codec, crypto, async runtime) and review upgrades carefully — Rust workspace tracks `Cargo.lock` for reproducibility.
- For the frontend, commit `package-lock.json`.
- Never add a top-level `Cargo.toml` — workspace member or nothing.

## File / module layout

- New Rust crate → `crates/<name>/` with `Cargo.toml` + `src/lib.rs`, then add to `[workspace] members` in root `Cargo.toml`.
- New frontend feature → `frontend/src/features/<feature>/` with co-located `.tsx` + `.css` + (optional) `*.test.tsx`.
- New Tauri command → append to `commands.rs`, register in `register_all`.
- New IPC payload type → define in `crates/orange-core` (single source of truth).

## Forbidden patterns

- Direct `println!` in library code (use `tracing`)
- `unwrap()` outside tests or `expect("invariant: ...")` with an obvious invariant
- Adding `#[tauri::command]` outside `commands.rs::register_all`
- Hardcoded API keys / cookies / tokens in source or fixtures
- Cross-crate imports that skip the dependency hierarchy (e.g. `orange-audio` must not import `orange-tauri`)
- Frontend direct `fetch()` to private third-party APIs (must go through Tauri IPC for CORS / cookie handling)

## Testing expectations (when test infrastructure lands)

- New public API in a crate → at least one happy-path `#[cfg(test)] mod tests`.
- New Tauri command → `tester` rein adds an integration smoke check.
- New frontend component → Vitest render test if it has non-trivial logic; skip for pure-presentation components.
- Manually verified flows: `.\run.ps1` for desktop, `cargo run` in `server/` for social backend.