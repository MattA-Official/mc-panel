//! Block and biome colours.
//!
//! A palette is a small text file, one entry per line:
//!
//! ```text
//! # comments and blank lines are ignored
//! block minecraft:stone 7d7d7d
//! block minecraft:grass_block 949494 grass
//! block minecraft:glass 00000000
//! biome minecraft:plains 91bd59 77ab2f 3f76e4
//! ```
//!
//! A block has a colour (`rrggbb`, or `rrggbbaa` where alpha `00` means "see through, keep
//! looking down") and an optional tint: `grass`, `foliage` or `water`. Tinted colours are
//! multiplied by the biome's colour, as the game does. A biome has its grass, foliage and
//! water colours.
//!
//! The full palette is made from the game's own textures (`flytower-map palette`). A smaller
//! one is built in so the renderer works without it.

use std::collections::HashMap;
use std::fmt;

/// The built-in palette: common blocks and biomes, by eye from the vanilla textures.
pub const BUILTIN: &str = include_str!("builtin.palette");

/// How a block's colour changes with the biome.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tint {
    None,
    Grass,
    Foliage,
    Water,
}

/// What we draw for one block.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Block {
    pub rgba: [u8; 4],
    pub tint: Tint,
}

impl Block {
    /// See-through blocks (air, glass, torches) are skipped when looking for the surface.
    #[must_use]
    pub const fn invisible(self) -> bool {
        self.rgba[3] == 0
    }
}

/// A biome's tints.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Biome {
    pub grass: [u8; 3],
    pub foliage: [u8; 3],
    pub water: [u8; 3],
}

/// Index of a block in a [`Palette`].
pub type BlockId = u16;
/// Index of a biome in a [`Palette`].
pub type BiomeId = u16;

/// Blocks and biomes, looked up by name once per chunk section and then by index.
#[derive(Debug, Clone)]
pub struct Palette {
    blocks: Vec<Block>,
    block_ids: HashMap<String, BlockId>,
    biomes: Vec<Biome>,
    biome_ids: HashMap<String, BiomeId>,
    /// A hash of the source text, so a pass knows to redraw everything when colours change.
    pub hash: u64,
}

/// A line that couldn't be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    pub line: usize,
    pub why: &'static str,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "palette line {}: {}", self.line, self.why)
    }
}

impl std::error::Error for Error {}

/// Block 0: anything the palette doesn't know. A neutral grey, so it's visible but quiet.
pub const UNKNOWN_BLOCK: BlockId = 0;
/// Block 1: air, always see through.
pub const AIR: BlockId = 1;
/// Biome 0: anything the palette doesn't know, coloured like plains.
pub const UNKNOWN_BIOME: BiomeId = 0;

const PLAINS: Biome = Biome {
    grass: [0x91, 0xbd, 0x59],
    foliage: [0x77, 0xab, 0x2f],
    water: [0x3f, 0x76, 0xe4],
};

impl Palette {
    /// Reads a palette.
    ///
    /// # Errors
    ///
    /// On the first line that isn't a comment, a block or a biome.
    pub fn parse(text: &str) -> Result<Self, Error> {
        let mut p = Self {
            blocks: vec![
                Block {
                    rgba: [0x7f, 0x7f, 0x7f, 0xff],
                    tint: Tint::None,
                },
                Block {
                    rgba: [0; 4],
                    tint: Tint::None,
                },
            ],
            block_ids: HashMap::new(),
            biomes: vec![PLAINS],
            biome_ids: HashMap::new(),
            hash: fnv(text.as_bytes()),
        };
        for name in ["minecraft:air", "minecraft:cave_air", "minecraft:void_air"] {
            p.block_ids.insert(name.into(), AIR);
        }
        for (i, line) in text.lines().enumerate() {
            let err = |why| Error { line: i + 1, why };
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let words: Vec<&str> = line.split_ascii_whitespace().collect();
            match words.as_slice() {
                ["block", name, colour, rest @ ..] => {
                    let rgba =
                        rgba(colour).ok_or_else(|| err("a block colour is rrggbb or rrggbbaa"))?;
                    let tint = match rest {
                        [] => Tint::None,
                        ["grass"] => Tint::Grass,
                        ["foliage"] => Tint::Foliage,
                        ["water"] => Tint::Water,
                        _ => return Err(err("a block's tint is grass, foliage or water")),
                    };
                    let id =
                        BlockId::try_from(p.blocks.len()).map_err(|_| err("too many blocks"))?;
                    p.blocks.push(Block { rgba, tint });
                    p.block_ids.insert((*name).into(), id);
                }
                ["biome", name, grass, foliage, water] => {
                    let colour =
                        |s: &str| rgba(s).filter(|c| c[3] == 0xff).map(|c| [c[0], c[1], c[2]]);
                    let biome = Biome {
                        grass: colour(grass)
                            .ok_or_else(|| err("a biome's grass colour is rrggbb"))?,
                        foliage: colour(foliage)
                            .ok_or_else(|| err("a biome's foliage colour is rrggbb"))?,
                        water: colour(water)
                            .ok_or_else(|| err("a biome's water colour is rrggbb"))?,
                    };
                    let id =
                        BiomeId::try_from(p.biomes.len()).map_err(|_| err("too many biomes"))?;
                    p.biomes.push(biome);
                    p.biome_ids.insert((*name).into(), id);
                }
                _ => {
                    return Err(err(
                        "expected block NAME COLOUR [TINT] or biome NAME GRASS FOLIAGE WATER",
                    ));
                }
            }
        }
        Ok(p)
    }

    /// The built-in palette.
    ///
    /// # Panics
    ///
    /// Never: the built-in palette is checked by the tests.
    #[must_use]
    pub fn builtin() -> Self {
        Self::parse(BUILTIN).expect("the built-in palette parses")
    }

    #[must_use]
    pub fn block_id(&self, name: &str) -> BlockId {
        self.block_ids.get(name).copied().unwrap_or(UNKNOWN_BLOCK)
    }

    #[must_use]
    pub fn block(&self, id: BlockId) -> Block {
        self.blocks[usize::from(id)]
    }

    #[must_use]
    pub fn biome_id(&self, name: &str) -> BiomeId {
        self.biome_ids.get(name).copied().unwrap_or(UNKNOWN_BIOME)
    }

    #[must_use]
    pub fn biome(&self, id: BiomeId) -> Biome {
        self.biomes[usize::from(id)]
    }

    /// The colour of a block in a biome, tint applied.
    #[must_use]
    pub fn colour(&self, block: BlockId, biome: BiomeId) -> [u8; 4] {
        let b = self.block(block);
        let tint = match b.tint {
            Tint::None => return b.rgba,
            Tint::Grass => self.biome(biome).grass,
            Tint::Foliage => self.biome(biome).foliage,
            Tint::Water => self.biome(biome).water,
        };
        let mul = |c: u8, t: u8| u8::try_from(u16::from(c) * u16::from(t) / 255).unwrap_or(u8::MAX);
        [
            mul(b.rgba[0], tint[0]),
            mul(b.rgba[1], tint[1]),
            mul(b.rgba[2], tint[2]),
            b.rgba[3],
        ]
    }
}

fn rgba(hex: &str) -> Option<[u8; 4]> {
    if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let byte = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    match hex.len() {
        6 => Some([byte(0)?, byte(2)?, byte(4)?, 0xff]),
        8 => Some([byte(0)?, byte(2)?, byte(4)?, byte(6)?]),
        _ => None,
    }
}

/// FNV-1a: tiny, and good enough to notice a change.
#[must_use]
pub fn fnv(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, &b| {
        (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_builtin_palette_parses() {
        let p = Palette::builtin();
        assert_ne!(p.block_id("minecraft:stone"), UNKNOWN_BLOCK);
        assert_ne!(p.block_id("minecraft:water"), UNKNOWN_BLOCK);
        assert_ne!(p.biome_id("minecraft:desert"), UNKNOWN_BIOME);
    }

    #[test]
    fn air_is_always_see_through() {
        let p = Palette::parse("").unwrap();
        for name in ["minecraft:air", "minecraft:cave_air", "minecraft:void_air"] {
            assert!(p.block(p.block_id(name)).invisible());
        }
        assert_eq!(p.block_id("minecraft:nope"), UNKNOWN_BLOCK);
        assert!(!p.block(UNKNOWN_BLOCK).invisible());
    }

    #[test]
    fn tints_multiply_by_the_biome() {
        let p = Palette::parse("block g ffffff grass\nbiome b 102030 405060 708090\n").unwrap();
        let (g, b) = (p.block_id("g"), p.biome_id("b"));
        assert_eq!(p.colour(g, b), [0x10, 0x20, 0x30, 0xff]);
        assert_eq!(p.colour(g, UNKNOWN_BIOME), [0x91, 0xbd, 0x59, 0xff]);
    }

    #[test]
    fn bad_lines_say_where() {
        assert_eq!(Palette::parse("\nblock x red").unwrap_err().line, 2);
        assert!(Palette::parse("block x ffffff purple").is_err());
        assert!(Palette::parse("biome x ffffff ffffff").is_err());
        assert!(Palette::parse("tile x").is_err());
    }
}
