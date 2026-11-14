//! A chunk's blocks and biomes, decoded from its NBT (the format used since Minecraft 1.18).
//!
//! Each 16-block-tall section stores its blocks as a palette of block states plus indices
//! packed into longs, and its biomes the same way at 4×4×4 resolution. We resolve each
//! palette entry against the colour [`Palette`] once, so drawing is just lookups.

use crate::nbt::Tag;
use crate::palette::{AIR, BiomeId, BlockId, Palette, UNKNOWN_BIOME};

/// One 16×16×16 section.
#[derive(Debug, Clone)]
pub struct Section {
    /// Section index: blocks from `y * 16` to `y * 16 + 15`.
    pub y: i32,
    blocks: Packed,
    biomes: Packed,
}

impl Section {
    /// The block at local coordinates (each 0 to 15).
    #[must_use]
    pub fn block(&self, x: usize, y: usize, z: usize) -> BlockId {
        self.blocks.get(y << 8 | z << 4 | x)
    }

    /// The biome around local block coordinates (each 0 to 15).
    #[must_use]
    pub fn biome(&self, x: usize, y: usize, z: usize) -> BiomeId {
        self.biomes.get((y >> 2) << 4 | (z >> 2) << 2 | x >> 2)
    }

    /// The single block the whole section is made of, if it is just one (usually air).
    #[must_use]
    pub fn uniform(&self) -> Option<BlockId> {
        match self.blocks.palette.as_slice() {
            [only] => Some(*only),
            _ => None,
        }
    }
}

/// A palette plus indices into it, packed into 64-bit words. Since 1.16 an index never
/// spans two words.
#[derive(Debug, Clone)]
struct Packed {
    palette: Vec<u16>,
    bits: u32,
    data: Vec<u64>,
}

impl Packed {
    fn get(&self, i: usize) -> u16 {
        if self.bits == 0 {
            return self.palette[0];
        }
        let per_word = 64 / self.bits as usize;
        let word = self.data.get(i / per_word).copied().unwrap_or(0);
        let shift = u32::try_from(i % per_word).unwrap_or(0) * self.bits;
        let index = (word >> shift) & ((1 << self.bits) - 1);
        usize::try_from(index)
            .ok()
            .and_then(|n| self.palette.get(n))
            .copied()
            .unwrap_or(self.palette[0])
    }

    /// Works out the width of each index. The game picks it from the palette size, with a
    /// floor (4 bits for blocks); we check that against the data's length, and otherwise
    /// trust the length.
    fn new(
        palette: Vec<u16>,
        data: &[i64],
        entries: usize,
        min_bits: u32,
    ) -> Result<Self, &'static str> {
        if palette.is_empty() {
            return Err("a section has an empty palette");
        }
        if palette.len() == 1 {
            return Ok(Self {
                palette,
                bits: 0,
                data: Vec::new(),
            });
        }
        let words = |bits: u32| entries.div_ceil(64 / bits as usize);
        let needed = usize::BITS - (palette.len() - 1).leading_zeros();
        let bits = needed.max(min_bits);
        let bits = if words(bits) == data.len() {
            bits
        } else {
            (needed..=32)
                .find(|&b| words(b) == data.len())
                .ok_or("a section's data is the wrong length")?
        };
        Ok(Self {
            palette,
            bits,
            data: data
                .iter()
                .map(|&w| u64::from_ne_bytes(w.to_ne_bytes()))
                .collect(),
        })
    }
}

/// A chunk ready to draw: its sections, highest first.
#[derive(Debug, Clone, Default)]
pub struct Chunk {
    pub sections: Vec<Section>,
}

/// Decodes a chunk. Returns `Ok(None)` for chunks the game hasn't finished generating,
/// which would otherwise show half-built terrain.
///
/// # Errors
///
/// When the chunk is from before 1.18 or its sections don't make sense.
pub fn decode(nbt: &Tag, palette: &Palette) -> Result<Option<Chunk>, &'static str> {
    if nbt.get("Level").is_some() {
        return Err("chunk is from before Minecraft 1.18; open the world in a newer version first");
    }
    let status = nbt.get("Status").and_then(Tag::as_str).unwrap_or("");
    if status.strip_prefix("minecraft:").unwrap_or(status) != "full" {
        return Ok(None);
    }
    let mut sections = Vec::new();
    for section in nbt.get("sections").and_then(Tag::as_list).unwrap_or(&[]) {
        let Some(y) = section.get("Y").and_then(Tag::as_i32) else {
            continue;
        };
        let Some(block_states) = section.get("block_states") else {
            // Sections outside the world's height carry only light.
            continue;
        };
        let names = block_states
            .get("palette")
            .and_then(Tag::as_list)
            .unwrap_or(&[]);
        let ids = names
            .iter()
            .map(|s| block_name(s).map_or(AIR, |n| palette.block_id(n)))
            .collect();
        let data = block_states
            .get("data")
            .and_then(Tag::as_longs)
            .unwrap_or(&[]);
        let blocks = Packed::new(ids, data, 4096, 4)?;

        let biomes = match section.get("biomes") {
            Some(b) => {
                let names = b.get("palette").and_then(Tag::as_list).unwrap_or(&[]);
                let ids = names
                    .iter()
                    .map(|n| n.as_str().map_or(UNKNOWN_BIOME, |n| palette.biome_id(n)))
                    .collect();
                let data = b.get("data").and_then(Tag::as_longs).unwrap_or(&[]);
                Packed::new(ids, data, 64, 1)?
            }
            None => Packed {
                palette: vec![UNKNOWN_BIOME],
                bits: 0,
                data: Vec::new(),
            },
        };
        sections.push(Section { y, blocks, biomes });
    }
    sections.sort_by_key(|s| std::cmp::Reverse(s.y));
    Ok(Some(Chunk { sections }))
}

/// A block palette entry's name. Up to Minecraft 26.2 every entry is `{Name, Properties}`.
/// From 26.3 a block saved with its default state is just its name, one with other
/// properties is `{id, properties}`, and in a list that mixes the two the plain names are
/// wrapped as `{"": name}`, as the game does for any list holding mixed types.
fn block_name(entry: &Tag) -> Option<&str> {
    entry.as_str().or_else(|| {
        ["Name", "id", ""]
            .into_iter()
            .find_map(|key| entry.get(key).and_then(Tag::as_str))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unpacks_indices_that_never_span_words() {
        // 5 bits each, 12 to a word: index 12 starts the second word.
        let mut data = vec![0i64; 342];
        data[0] = 3 | 7 << 55;
        data[1] = 9;
        let palette = (0..20).collect();
        let p = Packed::new(palette, &data, 4096, 4).unwrap();
        assert_eq!(p.bits, 5);
        assert_eq!((p.get(0), p.get(11), p.get(12), p.get(13)), (3, 7, 9, 0));
    }

    #[test]
    fn small_palettes_use_the_floor() {
        // Two entries still take four bits for blocks, one bit for biomes.
        assert_eq!(Packed::new(vec![1, 2], &[0; 256], 4096, 4).unwrap().bits, 4);
        assert_eq!(Packed::new(vec![1, 2], &[0; 1], 64, 1).unwrap().bits, 1);
    }

    #[test]
    fn out_of_range_indices_fall_back() {
        let p = Packed::new(vec![5, 6], &[-1; 256], 4096, 4).unwrap();
        assert_eq!(p.get(0), 5);
    }

    fn compound(fields: Vec<(&str, Tag)>) -> Tag {
        Tag::Compound(fields.into_iter().map(|(k, v)| (k.to_owned(), v)).collect())
    }

    fn text(s: &str) -> Tag {
        Tag::String(s.to_owned())
    }

    /// A chunk with one section: index 1 of `entries` at the bottom row, air above.
    fn chunk_with(entries: Vec<Tag>) -> Tag {
        let mut data = vec![0i64; 256];
        for word in &mut data[..16] {
            // Sixteen 4-bit indices of 1 per word: the bottom 256 blocks.
            *word = 0x1111_1111_1111_1111;
        }
        compound(vec![
            ("Status", text("minecraft:full")),
            (
                "sections",
                Tag::List(vec![compound(vec![
                    ("Y", Tag::Byte(0)),
                    (
                        "block_states",
                        compound(vec![
                            ("palette", Tag::List(entries)),
                            ("data", Tag::LongArray(data)),
                        ]),
                    ),
                ])]),
            ),
        ])
    }

    #[test]
    fn reads_every_way_the_game_writes_block_names() {
        let palette = Palette::builtin();
        let stone = palette.block_id("minecraft:stone");
        let leaves = palette.block_id("minecraft:oak_leaves");
        let props = || compound(vec![("distance", text("1"))]);
        let cases = [
            // Up to 26.2: always {Name, Properties}.
            (
                vec![
                    compound(vec![("Name", text("minecraft:air"))]),
                    compound(vec![("Name", text("minecraft:stone"))]),
                ],
                stone,
            ),
            // 26.3, every block in its default state: plain names.
            (vec![text("minecraft:air"), text("minecraft:stone")], stone),
            // 26.3, mixed: plain names wrapped as {"": name}, the rest {id, properties}.
            (
                vec![
                    compound(vec![("", text("minecraft:air"))]),
                    compound(vec![
                        ("id", text("minecraft:oak_leaves")),
                        ("properties", props()),
                    ]),
                ],
                leaves,
            ),
            (
                vec![
                    compound(vec![
                        ("id", text("minecraft:oak_leaves")),
                        ("properties", props()),
                    ]),
                    compound(vec![("", text("minecraft:stone"))]),
                ],
                stone,
            ),
        ];
        for (entries, want) in cases {
            let chunk = decode(&chunk_with(entries.clone()), &palette)
                .unwrap()
                .unwrap();
            let section = &chunk.sections[0];
            assert_eq!(section.block(3, 0, 7), want, "{entries:?}");
            assert_eq!(section.block(3, 1, 7), section.block(0, 15, 0));
        }
    }

    #[test]
    fn wrong_lengths_are_errors() {
        assert!(Packed::new(vec![1, 2], &[0; 7], 4096, 4).is_err());
        assert!(Packed::new(vec![], &[], 4096, 4).is_err());
    }
}
