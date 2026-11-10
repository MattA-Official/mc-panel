//! Flytower's system helper, in Rust. It runs as root and does a fixed list of jobs for the
//! panel, over the same newline-delimited JSON protocol as the TypeScript agent
//! (`packages/agent`), which it will replace a verb at a time. See
//! `docs/decisions/0001-rust-and-go.md`.

pub mod envelope;
pub mod verbs;
