//! Tile files: 512×512 PNGs, written atomically so a viewer never sees half a tile.
//!
//! Zoom level 0 is one tile per region (one pixel per block). Each level above halves the
//! detail: tile `(x, z)` at level `n` is made from tiles `(2x..2x+1, 2z..2z+1)` at level
//! `n - 1`, so level `n` covers `2ⁿ` regions a side.

use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, ErrorKind, Write};
use std::path::{Path, PathBuf};

use crate::draw::SIZE;

/// Where a tile lives under a dimension's tile folder.
#[must_use]
pub fn path(dir: &Path, level: u8, x: i32, z: i32) -> PathBuf {
    dir.join(level.to_string()).join(format!("{x}_{z}.png"))
}

/// Writes a tile, replacing any old one in one step.
///
/// # Errors
///
/// When the folder or file can't be written.
pub fn write(path: &Path, rgba: &[u8]) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("png.tmp");
    {
        let mut out = BufWriter::new(File::create(&tmp)?);
        let side = u32::try_from(SIZE).unwrap_or(u32::MAX);
        let mut encoder = png::Encoder::new(&mut out, side, side);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        let mut writer = encoder.write_header().map_err(io::Error::other)?;
        writer.write_image_data(rgba).map_err(io::Error::other)?;
        writer.finish().map_err(io::Error::other)?;
        out.flush()?;
    }
    fs::rename(&tmp, path)
}

/// Reads a tile we wrote. Missing, unreadable or odd-shaped files count as no tile.
#[must_use]
pub fn read(path: &Path) -> Option<Vec<u8>> {
    let file = File::open(path).ok()?;
    let mut decoder = png::Decoder::new(BufReader::new(file));
    decoder.set_transformations(png::Transformations::EXPAND);
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buf).ok()?;
    let ok = info.width as usize == SIZE
        && info.height as usize == SIZE
        && info.color_type == png::ColorType::Rgba
        && info.bit_depth == png::BitDepth::Eight;
    ok.then(|| {
        buf.truncate(SIZE * SIZE * 4);
        buf
    })
}

/// Removes a tile if it's there.
///
/// # Errors
///
/// When it exists but can't be removed.
pub fn remove(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// Shrinks four tiles (north-west, north-east, south-west, south-east) into one. Each
/// output pixel averages a 2×2 block, weighted by alpha so clear edges don't darken the
/// colours next to them. Returns `None` when all four are missing.
#[must_use]
pub fn shrink(quads: [Option<&[u8]>; 4]) -> Option<Vec<u8>> {
    if quads.iter().all(Option::is_none) {
        return None;
    }
    let half = SIZE / 2;
    let mut out = vec![0; SIZE * SIZE * 4];
    for (q, tile) in quads.iter().enumerate() {
        let Some(tile) = tile else { continue };
        let (ox, oz) = (q % 2 * half, q / 2 * half);
        for z in 0..half {
            for x in 0..half {
                let mut sum = [0u32; 4];
                for (dx, dz) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                    let i = ((z * 2 + dz) * SIZE + x * 2 + dx) * 4;
                    let a = u32::from(tile[i + 3]);
                    for c in 0..3 {
                        sum[c] += u32::from(tile[i + c]) * a;
                    }
                    sum[3] += a;
                }
                let o = ((oz + z) * SIZE + ox + x) * 4;
                for c in 0..3 {
                    out[o + c] = sum[c]
                        .checked_div(sum[3])
                        .map_or(0, |v| u8::try_from(v).unwrap_or(u8::MAX));
                }
                out[o + 3] = u8::try_from(sum[3] / 4).unwrap_or(u8::MAX);
            }
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shrinking_weights_by_alpha() {
        let mut nw = vec![0; SIZE * SIZE * 4];
        // Top-left 2×2: one red pixel, three clear.
        nw[..4].copy_from_slice(&[200, 0, 0, 255]);
        let out = shrink([Some(&nw), None, None, None]).unwrap();
        assert_eq!(&out[..4], &[200, 0, 0, 63]);
        // The other quarters stay clear.
        let se = ((SIZE / 2) * SIZE + SIZE / 2) * 4;
        assert_eq!(&out[se..se + 4], &[0, 0, 0, 0]);
        assert!(shrink([None, None, None, None]).is_none());
    }

    #[test]
    fn tiles_round_trip() {
        let dir = std::env::temp_dir().join(format!("flytower-map-tiles-{}", std::process::id()));
        let p = path(&dir, 0, -1, 2);
        let mut rgba = vec![0; SIZE * SIZE * 4];
        rgba[4..8].copy_from_slice(&[1, 2, 3, 4]);
        write(&p, &rgba).unwrap();
        assert_eq!(read(&p).as_deref(), Some(&rgba[..]));
        remove(&p).unwrap();
        remove(&p).unwrap();
        assert!(read(&p).is_none());
        let _ = fs::remove_dir_all(dir);
    }
}
