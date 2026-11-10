//! A web map for Flytower: reads a Minecraft world's region files and draws them as tiles,
//! looking straight down, for the panel's own map viewer.
//!
//! It runs outside the Minecraft server, so it works for vanilla, Fabric and Paper alike and
//! needs nothing installed in the game. A pass only redraws regions whose chunks were saved
//! since the last one.
//!
//! Output, under the folder you give it:
//!
//! - `tiles/<namespace>/<name>/<level>/<x>_<z>.png`: 512×512 tiles. Level 0 is one per
//!   region (one pixel per block); each level up halves the detail.
//! - `maps.json`: the dimensions that have tiles, where they are and how far they reach.
//! - `state/`: what was drawn, so the next pass knows what changed.

pub mod chunk;
pub mod nbt;
pub mod palette;
pub mod region;
