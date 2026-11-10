use std::fs::{self, File};
use std::io::Write;
use std::os::unix::fs::{MetadataExt, PermissionsExt, symlink};
use std::path::{Path, PathBuf};

use flytower_du::{Measured, Options, measure_all};

/// A fresh, empty folder for one test.
fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("flytower-du-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write(path: &Path, bytes: usize) {
    let mut f = File::create(path).unwrap();
    f.write_all(&vec![7u8; bytes]).unwrap();
    f.sync_all().unwrap();
}

fn blocks(path: &Path) -> u64 {
    fs::symlink_metadata(path).unwrap().blocks() * 512
}

fn one(path: &Path) -> Measured {
    measure_all(&[path], Options::default())[0]
}

#[test]
fn counts_files_and_folders_by_blocks() {
    let d = scratch("blocks");
    fs::create_dir(d.join("region")).unwrap();
    write(&d.join("level.dat"), 1000);
    write(&d.join("region/r.0.0.mca"), 100_000);
    let want = blocks(&d)
        + blocks(&d.join("region"))
        + blocks(&d.join("level.dat"))
        + blocks(&d.join("region/r.0.0.mca"));
    assert_eq!(
        one(&d),
        Measured {
            bytes: want,
            unreadable: 0
        }
    );
}

#[test]
fn counts_sparse_files_for_what_they_use() {
    let d = scratch("sparse");
    let f = File::create(d.join("r.0.0.mca")).unwrap();
    f.set_len(1 << 30).unwrap();
    let m = one(&d.join("r.0.0.mca"));
    assert!(
        m.bytes < 1 << 20,
        "a 1 GiB hole counted as {} bytes",
        m.bytes
    );
}

#[test]
fn never_follows_symlinks() {
    let d = scratch("symlinks");
    let elsewhere = scratch("symlinks-target");
    write(&elsewhere.join("big"), 1 << 20);
    symlink(elsewhere.join("big"), d.join("file-link")).unwrap();
    symlink(&elsewhere, d.join("dir-link")).unwrap();
    assert_eq!(one(&d).bytes, blocks(&d));
    assert_eq!(one(&d.join("dir-link")), Measured::default());
}

#[test]
fn counts_a_missing_path_as_nothing() {
    assert_eq!(one(Path::new("/nonexistent/flytower")), Measured::default());
}

#[test]
fn counts_hard_links_once_across_every_path() {
    let d = scratch("hardlinks");
    fs::create_dir(d.join("a")).unwrap();
    fs::create_dir(d.join("b")).unwrap();
    write(&d.join("a/world.tar"), 64_000);
    fs::hard_link(d.join("a/world.tar"), d.join("b/world.tar")).unwrap();
    let file = blocks(&d.join("a/world.tar"));
    let r = measure_all(&[d.join("a"), d.join("b")], Options::default());
    assert_eq!(r[0].bytes, blocks(&d.join("a")) + file);
    assert_eq!(
        r[1].bytes,
        blocks(&d.join("b")),
        "the second link counted again"
    );
    // Separate calls don't share what they've seen.
    assert_eq!(one(&d.join("b")).bytes, blocks(&d.join("b")) + file);
}

#[test]
fn counts_an_unreadable_folder_and_carries_on() {
    let d = scratch("unreadable");
    fs::create_dir(d.join("locked")).unwrap();
    write(&d.join("locked/secret"), 10_000);
    write(&d.join("open"), 10_000);
    fs::set_permissions(d.join("locked"), fs::Permissions::from_mode(0o000)).unwrap();
    let readable_anyway = fs::read_dir(d.join("locked")).is_ok(); // running as root
    let m = one(&d);
    fs::set_permissions(d.join("locked"), fs::Permissions::from_mode(0o755)).unwrap();
    if readable_anyway {
        return;
    }
    assert_eq!(m.unreadable, 1);
    assert_eq!(
        m.bytes,
        blocks(&d) + blocks(&d.join("locked")) + blocks(&d.join("open"))
    );
}

#[test]
fn gives_the_same_answer_on_one_thread_or_many() {
    let d = scratch("threads");
    for i in 0..20 {
        let sub = d.join(format!("d{i}"));
        fs::create_dir_all(sub.join("deeper")).unwrap();
        for j in 0..10 {
            write(&sub.join(format!("f{j}")), 4096 * (j + 1));
            write(&sub.join("deeper").join(format!("g{j}")), 100 * j);
        }
    }
    let single = measure_all(
        &[&d],
        Options {
            threads: 1,
            one_file_system: false,
        },
    );
    let many = measure_all(
        &[&d],
        Options {
            threads: 8,
            one_file_system: false,
        },
    );
    assert_eq!(single, many);
    assert!(single[0].bytes > 0);
}
