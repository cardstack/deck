//! Notes for an in-process jj-lib backend (not compiled in this POC).
//!
//! Local jj checkout for spikes: `/Users/chris/Projects/jj` (`jj-lib` in `lib/`).
//!
//! ## Why CLI first
//!
//! Linking jj-lib pulls a large workspace (gitoxide, prost, edition 2024 /
//! recent rustc). The HTTP + layout + actor/`file-list-at` gaps are what we
//! need to prove first; fork/exec cost is the known historyd motivation.
//!
//! ## Intended call sequence (jj-lib)
//!
//! ```text
//! UserSettings::from_config(...)
//! Workspace::init_internal_git(settings, workspace_root, object_hash)  // NOT colocated
//!   → today creates <root>/.jj  — customize to <root>/.deck/timeline
//!     (needs create_jj_dir override or init + relocate, same as CLI POC)
//!
//! seal:
//!   locked = workspace.start_working_copy_mutation()
//!   locked.snapshot(SnapshotOptions { … auto-track fileset … })
//!   if tree unchanged → None
//!   tx = repo.start_transaction()
//!   commit = tx.repo_mut().new_commit(...).set_tree(...).set_description(msg)
//!            .set_author(actor).write()
//!   tx.commit()
//!   → Some(change_id.hex())
//!
//! list / file_at / file_list_at:
//!   revset "::@" or change_id; store.get_commit; tree entries / file bytes
//!
//! restore_plan:
//!   diff WC tree vs revision tree → writes + deletes (replay is caller's job)
//! ```
//!
//! ## Enabling later
//!
//! 1. Install a rustc that can build the sibling jj tree.
//! 2. Uncomment `jj-lib` path dep in `Cargo.toml`.
//! 3. Add `src/timeline/jj_lib.rs` implementing [`super::Timeline`].
//! 4. Select backend with `DECKD_TIMELINE=jj-lib`.
//!
//! Do **not** maintain a long-lived full fork of jj-vcs/jj unless a lib patch
//! for custom `.deck/timeline` without symlink is required upstream.

#![allow(dead_code)]

/// Marker so the module is not empty.
pub const JJ_LIB_SPIKE_ROOT_HINT: &str = "/Users/chris/Projects/jj";
