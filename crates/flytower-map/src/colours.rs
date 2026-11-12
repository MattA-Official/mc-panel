//! Makes a full palette from the Minecraft client jar, so the map uses the game's own
//! colours for every block and biome in that version.
//!
//! - **Blocks:** each block's first model state is followed through its model's parents to
//!   the texture you'd see from above (its top, end or whole face), and that texture is
//!   averaged, weighting each pixel by its opacity. Mostly see-through textures (glass,
//!   torches, rails) become see-through. Grass, foliage and water tints are the game's own
//!   list, which lives in its code rather than its data.
//! - **Biomes:** grass and foliage come from the biome's own colours where it sets them,
//!   otherwise from the colour maps by temperature and downfall, as the game does. Water is
//!   the biome's water colour.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::io::Cursor;

use serde_json::Value;

use crate::jar::{Error, Jar};

/// A texture counts as solid from above when at least this much of it is opaque.
const SOLID: f64 = 0.3;

/// Blocks the game tints, and how. Fixed tints are given as a colour.
const TINTS: &[(&str, &str)] = &[
    ("grass_block", "grass"),
    ("short_grass", "grass"),
    ("tall_grass", "grass"),
    ("fern", "grass"),
    ("large_fern", "grass"),
    ("potted_fern", "grass"),
    ("sugar_cane", "grass"),
    ("bush", "grass"),
    ("oak_leaves", "foliage"),
    ("jungle_leaves", "foliage"),
    ("acacia_leaves", "foliage"),
    ("dark_oak_leaves", "foliage"),
    ("mangrove_leaves", "foliage"),
    ("vine", "foliage"),
    ("water", "water"),
    ("bubble_column", "water"),
    ("birch_leaves", "80a755"),
    ("spruce_leaves", "619961"),
    ("lily_pad", "208030"),
];

/// Underwater plants: drawn as the water they stand in, so the sea floor shows through.
const IN_WATER: &[&str] = &[
    "kelp",
    "kelp_plant",
    "seagrass",
    "tall_seagrass",
    "bubble_column",
];

/// Builds the palette text from a client jar.
///
/// # Errors
///
/// When the jar has no block states or biomes, so isn't a client jar.
pub fn palette(jar: &Jar) -> Result<String, Error> {
    let version = jar
        .read("version.json")
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v.get("id").and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_else(|| "unknown".into());
    let mut text =
        format!("# flytower-map palette made from the Minecraft {version} client jar.\n");

    let blocks = blocks(jar);
    if blocks.is_empty() {
        return Err(Error(
            "the jar has no block states: is it the client jar?".into(),
        ));
    }
    let water = blocks.get("water").copied();
    for (name, rgba) in &blocks {
        let (rgba, tint) = match TINTS.iter().find(|(n, _)| n == name).map(|(_, t)| *t) {
            _ if IN_WATER.contains(&name.as_str()) => match water {
                Some(w) => (w, Some("water")),
                None => continue,
            },
            Some(fixed) if fixed.len() == 6 => (multiply(*rgba, hex(fixed)), None),
            tint => (*rgba, tint),
        };
        let _ = write!(text, "block minecraft:{name} {}", colour(rgba));
        if let Some(tint) = tint {
            let _ = write!(text, " {tint}");
        }
        text.push('\n');
    }

    let biomes = biomes(jar);
    if biomes.is_empty() {
        return Err(Error("the jar has no biomes: is it the client jar?".into()));
    }
    for (name, [grass, foliage, water]) in &biomes {
        let _ = writeln!(
            text,
            "biome minecraft:{name} {grass:06x} {foliage:06x} {water:06x}"
        );
    }
    Ok(text)
}

fn colour(rgba: [u8; 4]) -> String {
    if rgba[3] == 0xff {
        format!("{:02x}{:02x}{:02x}", rgba[0], rgba[1], rgba[2])
    } else {
        "00000000".into()
    }
}

fn hex(s: &str) -> u32 {
    u32::from_str_radix(s.trim_start_matches('#'), 16).unwrap_or(0)
}

fn multiply(rgba: [u8; 4], tint: u32) -> [u8; 4] {
    let t = tint.to_be_bytes();
    let m = |c: u8, t: u8| u8::try_from(u16::from(c) * u16::from(t) / 255).unwrap_or(u8::MAX);
    [
        m(rgba[0], t[1]),
        m(rgba[1], t[2]),
        m(rgba[2], t[3]),
        rgba[3],
    ]
}

fn json(jar: &Jar, path: &str) -> Option<Value> {
    serde_json::from_slice(&jar.read(path)?).ok()
}

/// Every block's colour from above, by name without the namespace.
fn blocks(jar: &Jar) -> BTreeMap<String, [u8; 4]> {
    let mut out = BTreeMap::new();
    for path in jar.names() {
        let Some(name) = path
            .strip_prefix("assets/minecraft/blockstates/")
            .and_then(|p| p.strip_suffix(".json"))
        else {
            continue;
        };
        let Some(state) = json(jar, path) else {
            continue;
        };
        let Some(model) = first_model(&state) else {
            continue;
        };
        let Some(texture) = top_texture(jar, &model) else {
            continue;
        };
        if let Some(rgba) = average(jar, &texture) {
            out.insert(name.to_owned(), rgba);
        }
    }
    out
}

/// The model of a block's first state, from either form of block state file.
fn first_model(state: &Value) -> Option<String> {
    let pick = |v: &Value| -> Option<String> {
        let v = v.as_array().and_then(|a| a.first()).unwrap_or(v);
        v.get("model")?.as_str().map(str::to_owned)
    };
    if let Some(variants) = state.get("variants").and_then(Value::as_object) {
        return variants
            .get("")
            .or_else(|| variants.values().next())
            .and_then(pick);
    }
    let parts = state.get("multipart")?.as_array()?;
    parts.iter().find_map(|p| p.get("apply").and_then(pick))
}

/// `minecraft:block/stone` or `block/stone` to a path in the jar.
fn asset(id: &str, kind: &str, ext: &str) -> String {
    let (ns, path) = id.split_once(':').unwrap_or(("minecraft", id));
    format!("assets/{ns}/{kind}/{path}.{ext}")
}

/// Follows a model's parents, collecting its texture variables (children win), then picks
/// the face you'd see from above.
fn top_texture(jar: &Jar, model: &str) -> Option<String> {
    let mut textures: BTreeMap<String, String> = BTreeMap::new();
    let mut next = Some(model.to_owned());
    for _ in 0..16 {
        let Some(id) = next.take() else { break };
        let Some(m) = json(jar, &asset(&id, "models", "json")) else {
            break;
        };
        if let Some(t) = m.get("textures").and_then(Value::as_object) {
            for (k, v) in t {
                // Newer versions can give an object with a `sprite` instead of a plain name.
                if let Some(v) = v
                    .as_str()
                    .or_else(|| v.get("sprite").and_then(Value::as_str))
                {
                    textures.entry(k.clone()).or_insert_with(|| v.to_owned());
                }
            }
        }
        next = m.get("parent").and_then(Value::as_str).map(str::to_owned);
    }
    let order = [
        "top", "end", "up", "all", "texture", "cross", "plant", "crop", "side", "particle",
    ];
    let mut pick = order
        .iter()
        .find_map(|k| textures.get(*k))
        .or_else(|| textures.values().next())?
        .clone();
    for _ in 0..8 {
        match pick.strip_prefix('#') {
            Some(var) => pick.clone_from(textures.get(var)?),
            None => return Some(pick),
        }
    }
    None
}

/// Decodes a PNG to RGBA, keeping only the first frame of an animated strip.
fn rgba(bytes: &[u8]) -> Option<(usize, usize, Vec<u8>)> {
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buf).ok()?;
    let (width, height) = (info.width as usize, info.height as usize);
    let channels = match info.color_type {
        png::ColorType::Grayscale => 1,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        png::ColorType::Indexed => return None,
    };
    let height = height.min(width);
    let mut out = Vec::with_capacity(width * height * 4);
    for px in buf.chunks_exact(channels).take(width * height) {
        out.extend(match *px {
            [grey] => [grey, grey, grey, 255],
            [grey, alpha] => [grey, grey, grey, alpha],
            [red, green, blue] => [red, green, blue, 255],
            [red, green, blue, alpha] => [red, green, blue, alpha],
            _ => return None,
        });
    }
    Some((width, height, out))
}

/// A texture's colour: opacity-weighted average, solid or see-through.
fn average(jar: &Jar, texture: &str) -> Option<[u8; 4]> {
    let (w, h, px) = rgba(&jar.read(&asset(texture, "textures", "png"))?)?;
    let mut sum = [0u64; 4];
    for p in px.chunks_exact(4) {
        let a = u64::from(p[3]);
        for c in 0..3 {
            sum[c] += u64::from(p[c]) * a;
        }
        sum[3] += a;
    }
    let pixels = u64::try_from(w * h).ok()?.max(1);
    #[expect(
        clippy::cast_precision_loss,
        reason = "a texture has far fewer than 2^52 pixels"
    )]
    let cover = sum[3] as f64 / (pixels * 255) as f64;
    if cover < SOLID || sum[3] == 0 {
        return Some([0; 4]);
    }
    let c = |i: usize| u8::try_from(sum[i] / sum[3]).unwrap_or(u8::MAX);
    Some([c(0), c(1), c(2), 0xff])
}

/// Every biome's grass, foliage and water colours.
fn biomes(jar: &Jar) -> BTreeMap<String, [u32; 3]> {
    let grass = jar
        .read("assets/minecraft/textures/colormap/grass.png")
        .and_then(|b| rgba(&b));
    let foliage = jar
        .read("assets/minecraft/textures/colormap/foliage.png")
        .and_then(|b| rgba(&b));
    let mut out = BTreeMap::new();
    for path in jar.names() {
        let Some(name) = path
            .strip_prefix("data/minecraft/worldgen/biome/")
            .and_then(|p| p.strip_suffix(".json"))
        else {
            continue;
        };
        if name.contains('/') {
            continue;
        }
        let Some(b) = json(jar, path) else { continue };
        let temp = b.get("temperature").and_then(Value::as_f64).unwrap_or(0.5);
        let downfall = b.get("downfall").and_then(Value::as_f64).unwrap_or(0.5);
        let effects = b.get("effects");
        let colour_of = |key: &str| {
            let v = effects?.get(key)?;
            v.as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .or_else(|| v.as_str().map(hex))
        };
        let mut g = colour_of("grass_color")
            .unwrap_or_else(|| colormap(grass.as_ref(), temp, downfall, 0x0091_bd59));
        match effects
            .and_then(|e| e.get("grass_color_modifier"))
            .and_then(Value::as_str)
        {
            Some("dark_forest") => g = ((g & 0xfe_fefe) + 0x28_340a) >> 1,
            Some("swamp") => g = 0x6a_7039,
            _ => {}
        }
        let f = colour_of("foliage_color")
            .unwrap_or_else(|| colormap(foliage.as_ref(), temp, downfall, 0x0077_ab2f));
        let w = colour_of("water_color").unwrap_or(0x3f_76e4);
        out.insert(name.to_owned(), [g, f, w]);
    }
    out
}

/// Looks up a colour map the way the game does: across by temperature, down by downfall
/// times temperature. The game keeps both as 32-bit floats and truncates, so we do too, or
/// some biomes land one pixel over.
fn colormap(map: Option<&(usize, usize, Vec<u8>)>, temp: f64, downfall: f64, fallback: u32) -> u32 {
    let Some((width, height, px)) = map else {
        return fallback;
    };
    #[expect(
        clippy::cast_possible_truncation,
        reason = "the game stores these as floats"
    )]
    let (temp, downfall) = (
        f64::from(temp as f32).clamp(0.0, 1.0),
        f64::from(downfall as f32).clamp(0.0, 1.0),
    );
    let wet = downfall * temp;
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "both are 0 to 255"
    )]
    let (x, y) = (
        ((1.0 - temp) * 255.0) as usize,
        ((1.0 - wet) * 255.0) as usize,
    );
    if x >= *width || y >= *height {
        return fallback;
    }
    let i = (y * width + x) * 4;
    u32::from_be_bytes([0, px[i], px[i + 1], px[i + 2]])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jar::tests::zip;
    use crate::palette::{Palette, Tint};

    fn png(w: u32, h: u32, rgba: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut e = png::Encoder::new(&mut out, w, h);
        e.set_color(png::ColorType::Rgba);
        e.set_depth(png::BitDepth::Eight);
        let mut writer = e.write_header().unwrap();
        writer.write_image_data(rgba).unwrap();
        writer.finish().unwrap();
        out
    }

    fn solid(r: u8, g: u8, b: u8) -> Vec<u8> {
        png(2, 2, &[r, g, b, 255].repeat(4))
    }

    #[test]
    fn makes_a_palette_from_a_jar() {
        // A 256×256 grass map with one known pixel: plains (0.8, 0.4) reads (50, 173), as in the game.
        let mut grass = vec![0u8; 256 * 256 * 4];
        let i = (173 * 256 + 50) * 4;
        grass[i..i + 4].copy_from_slice(&[0x12, 0x34, 0x56, 255]);
        let half_clear = png(
            2,
            2,
            &[[9, 9, 9, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]].concat(),
        );
        let files: Vec<(&str, Vec<u8>)> = vec![
            ("version.json", br#"{"id":"26.3"}"#.to_vec()),
            ("assets/minecraft/blockstates/stone.json", br#"{"variants":{"":{"model":"minecraft:block/stone"}}}"#.to_vec()),
            ("assets/minecraft/models/block/stone.json", br#"{"parent":"block/cube_all","textures":{"all":"block/stone"}}"#.to_vec()),
            ("assets/minecraft/models/block/cube_all.json", br##"{"parent":"block/cube","textures":{"particle":"#all","up":"#all"}}"##.to_vec()),
            ("assets/minecraft/textures/block/stone.png", solid(100, 110, 120)),
            // Logs show their end from above.
            ("assets/minecraft/blockstates/oak_log.json", br#"{"variants":{"axis=x":[{"model":"block/oak_log"}],"axis=y":{"model":"block/oak_log"}}}"#.to_vec()),
            ("assets/minecraft/models/block/oak_log.json", br#"{"textures":{"end":"block/oak_log_top","side":"block/oak_log"}}"#.to_vec()),
            ("assets/minecraft/textures/block/oak_log_top.png", solid(200, 150, 100)),
            ("assets/minecraft/textures/block/oak_log.png", solid(1, 1, 1)),
            // Multipart, tinted.
            ("assets/minecraft/blockstates/grass_block.json", br#"{"multipart":[{"apply":{"model":"block/grass_block"}}]}"#.to_vec()),
            ("assets/minecraft/models/block/grass_block.json", br#"{"textures":{"top":"block/grass_block_top"}}"#.to_vec()),
            ("assets/minecraft/textures/block/grass_block_top.png", solid(128, 128, 128)),
            ("assets/minecraft/blockstates/spruce_leaves.json", br#"{"variants":{"":{"model":"block/spruce_leaves"}}}"#.to_vec()),
            ("assets/minecraft/models/block/spruce_leaves.json", br#"{"textures":{"all":"block/spruce_leaves"}}"#.to_vec()),
            ("assets/minecraft/textures/block/spruce_leaves.png", solid(255, 255, 255)),
            ("assets/minecraft/blockstates/glass.json", br#"{"variants":{"":{"model":"block/glass"}}}"#.to_vec()),
            ("assets/minecraft/models/block/glass.json", br#"{"textures":{"all":{"sprite":"block/glass","force_translucent":true}}}"#.to_vec()),
            ("assets/minecraft/textures/block/glass.png", half_clear),
            ("assets/minecraft/blockstates/water.json", br#"{"variants":{"":{"model":"block/water"}}}"#.to_vec()),
            ("assets/minecraft/models/block/water.json", br#"{"textures":{"particle":"block/water_still"}}"#.to_vec()),
            ("assets/minecraft/textures/block/water_still.png", png(1, 2, &[200, 200, 200, 255, 0, 0, 0, 255])),
            ("assets/minecraft/blockstates/kelp.json", br#"{"variants":{"":{"model":"block/kelp"}}}"#.to_vec()),
            ("assets/minecraft/models/block/kelp.json", br#"{"textures":{"cross":"block/kelp"}}"#.to_vec()),
            ("assets/minecraft/textures/block/kelp.png", solid(0, 255, 0)),
            ("assets/minecraft/textures/colormap/grass.png", png(256, 256, &grass)),
            ("data/minecraft/worldgen/biome/plains.json", br##"{"temperature":0.8,"downfall":0.4,"effects":{"water_color":"#3f76e4"}}"##.to_vec()),
            ("data/minecraft/worldgen/biome/swamp.json", br##"{"temperature":0.8,"downfall":0.9,"effects":{"foliage_color":"#6a7039","grass_color_modifier":"swamp","water_color":6388580}}"##.to_vec()),
        ];
        let refs: Vec<(&str, &[u8])> = files.iter().map(|(n, b)| (*n, b.as_slice())).collect();
        let text = palette(&Jar::new(zip(&refs)).unwrap()).unwrap();
        assert!(
            text.starts_with("# flytower-map palette made from the Minecraft 26.3 client jar.\n"),
            "{text}"
        );
        for line in [
            "block minecraft:stone 646e78",
            "block minecraft:oak_log c89664",
            "block minecraft:grass_block 808080 grass",
            "block minecraft:spruce_leaves 619961",
            "block minecraft:glass 00000000",
            "block minecraft:water c8c8c8 water",
            "block minecraft:kelp c8c8c8 water",
            "biome minecraft:plains 123456 77ab2f 3f76e4",
            "biome minecraft:swamp 6a7039 6a7039 617b64",
        ] {
            assert!(
                text.lines().any(|l| l == line),
                "missing {line:?} in\n{text}"
            );
        }
        let p = Palette::parse(&text).unwrap();
        assert_eq!(p.block(p.block_id("minecraft:kelp")).tint, Tint::Water);
    }

    #[test]
    fn refuses_a_jar_without_blocks() {
        let jar = Jar::new(zip(&[("version.json", b"{}")])).unwrap();
        assert!(palette(&jar).is_err());
    }
}
