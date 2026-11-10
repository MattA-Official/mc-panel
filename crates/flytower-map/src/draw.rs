//! Draws one region as a 512×512 image, one pixel per block column, looking straight down.
//!
//! For each column we walk down from the top to the first block you'd see. Water is looked
//! through: its colour is laid over the floor, darker the deeper it is. Then each pixel is
//! lit by comparing its height with the block to the north, as the game's own maps do, so
//! slopes and cliffs read at a glance.

use crate::chunk::{self, Chunk};
use crate::nbt;
use crate::palette::{Palette, Tint};
use crate::region::Region;

/// Pixels along each side of a region tile.
pub const SIZE: usize = 512;

/// How to draw a dimension.
#[derive(Debug, Clone, Copy, Default)]
pub struct Style {
    /// Start looking from this height, and look past the solid blocks there first. The
    /// Nether uses this to draw below its bedrock roof.
    pub ceiling: Option<i32>,
}

/// One region, drawn.
pub struct Drawn {
    /// RGBA, row by row from the north-west corner. Columns with nothing drawn are clear.
    pub pixels: Vec<u8>,
    /// Chunks that were drawn.
    pub chunks: u32,
    /// Chunks that couldn't be read, and the first reason why.
    pub errors: u32,
    pub first_error: Option<String>,
}

/// The top of one column.
#[derive(Clone, Copy)]
struct Column {
    rgba: [u8; 4],
    /// Height of what you see: the water's surface, or the block.
    height: i32,
    /// Blocks of water above the floor.
    depth: u32,
}

/// Draws every chunk in a region.
#[must_use]
pub fn region(region: &Region, palette: &Palette, style: Style) -> Drawn {
    let mut columns: Vec<Option<Column>> = vec![None; SIZE * SIZE];
    let mut drawn = Drawn {
        pixels: vec![0; SIZE * SIZE * 4],
        chunks: 0,
        errors: 0,
        first_error: None,
    };
    for i in 0..1024 {
        let chunk = match read(region, i, palette) {
            Ok(Some(chunk)) => chunk,
            Ok(None) => continue,
            Err(why) => {
                drawn.errors += 1;
                drawn.first_error.get_or_insert(why);
                continue;
            }
        };
        drawn.chunks += 1;
        let (cx, cz) = (i % 32 * 16, i / 32 * 16);
        for z in 0..16 {
            for x in 0..16 {
                columns[(cz + z) * SIZE + cx + x] = column(&chunk, x, z, palette, style);
            }
        }
    }
    for (i, col) in columns.iter().enumerate() {
        let Some(col) = col else { continue };
        let north = i.checked_sub(SIZE).and_then(|n| columns[n]);
        let light = match north {
            _ if col.depth > 0 => 1.0,
            Some(n) => 1.0 + 0.08 * f64::from((col.height - n.height).clamp(-3, 3)),
            None => 1.0,
        };
        let px = &mut drawn.pixels[i * 4..i * 4 + 4];
        for (p, c) in px.iter_mut().zip(col.rgba).take(3) {
            *p = scale(c, light);
        }
        px[3] = col.rgba[3];
    }
    drawn
}

fn read(region: &Region, i: usize, palette: &Palette) -> Result<Option<Chunk>, String> {
    let Some(bytes) = region.chunk(i).map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let tag = nbt::parse(&bytes).map_err(|e| e.to_string())?;
    chunk::decode(&tag, palette).map_err(str::to_owned)
}

/// Walks one column down to the first block you'd see.
fn column(chunk: &Chunk, x: usize, z: usize, palette: &Palette, style: Style) -> Option<Column> {
    // Under a roof until we've passed through some air.
    let mut roofed = style.ceiling.is_some();
    let mut water: Option<([u8; 4], i32)> = None;
    let mut depth = 0u32;
    let mut last_y = None;
    for section in &chunk.sections {
        let top = section.y * 16 + 15;
        // A missing section is all air.
        if last_y.is_some_and(|y: i32| y > top + 1) {
            roofed = false;
        }
        last_y = Some(section.y * 16);
        if let Some(ceiling) = style.ceiling
            && section.y * 16 > ceiling
        {
            continue;
        }
        if let Some(only) = section.uniform()
            && palette.block(only).invisible()
        {
            roofed = false;
            continue;
        }
        for ly in (0..16u8).rev() {
            let y = section.y * 16 + i32::from(ly);
            let ly = usize::from(ly);
            if style.ceiling.is_some_and(|c| y > c) {
                continue;
            }
            let id = section.block(x, ly, z);
            let block = palette.block(id);
            if block.invisible() {
                roofed = false;
                continue;
            }
            if roofed {
                continue;
            }
            let rgba = palette.colour(id, section.biome(x, ly, z));
            if block.tint == Tint::Water {
                if water.is_none() {
                    water = Some((rgba, y));
                }
                depth += 1;
                continue;
            }
            return Some(match water {
                None => Column {
                    rgba,
                    height: y,
                    depth: 0,
                },
                Some((w, height)) => Column {
                    rgba: under_water(w, rgba, depth),
                    height,
                    depth,
                },
            });
        }
    }
    // Water all the way down, or nothing at all (the End's void).
    water.map(|(rgba, height)| Column {
        rgba,
        height,
        depth,
    })
}

/// Lays water over the floor: clearer when shallow, darker when deep.
fn under_water(water: [u8; 4], floor: [u8; 4], depth: u32) -> [u8; 4] {
    let d = f64::from(depth.min(16));
    let cover = (0.55 + 0.04 * d).min(0.92);
    let dark = 1.0 - 0.025 * d;
    let mut out = [0, 0, 0, 0xff];
    for c in 0..3 {
        let mixed = f64::from(water[c]) * cover + f64::from(floor[c]) * (1.0 - cover);
        out[c] = scale_f(mixed * dark);
    }
    out
}

fn scale(c: u8, by: f64) -> u8 {
    scale_f(f64::from(c) * by)
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to 0..=255 first"
)]
fn scale_f(v: f64) -> u8 {
    v.round().clamp(0.0, 255.0) as u8
}
