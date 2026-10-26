// The Files drawer: a project's folders as a tree, as PhpStorm shows a project. Its roots are the code folders the
// vault's index links to the project (index/repos.json) and the project's folder in the vault. Every path the webview
// names must lie inside one of those roots once symlinks are resolved, so the tree never reaches ~/.ssh.
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const MAX_ENTRIES: usize = 2000;
const MAX_TEXT: u64 = 2_000_000;

/// The roots of a project: [{label, path, vault}], its code folders first (as repos.json lists them), then its folder in
/// the vault. A project without a note, or "" for none, gets the vault itself.
pub fn roots(vault: &str, repos_json: Option<String>, project: &str) -> Value {
    let root = PathBuf::from(crate::vault::canon(vault));
    let mut out = vec![];
    if !project.is_empty() {
        let idx: serde_json::Map<String, Value> = repos_json.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        let mut code: Vec<&String> = idx.iter()
            .filter(|(d, n)| Path::new(d.as_str()).is_dir() && n.as_str().and_then(|n| n.rsplit('/').next()).map(|n| n.trim_end_matches(".md")) == Some(project))
            .map(|(d, _)| d).collect();
        code.sort();
        for d in code {
            let label = Path::new(d).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| d.clone());
            out.push(json!({"label": label, "path": d, "vault": false}));
        }
    }
    let folder = crate::vault::note(vault, project).and_then(|(rel, _)| root.join(rel).parent().map(Path::to_path_buf))
        .filter(|_| !project.is_empty()).unwrap_or_else(|| root.clone());
    let label = folder.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    out.push(json!({"label": label, "path": folder.to_string_lossy(), "vault": true}));
    json!({"vault": root.to_string_lossy(), "roots": out})
}

/// `path` resolved, when it lies inside one of `roots` (resolved too), else an error.
fn inside(roots: &[String], path: &str) -> Result<PathBuf, String> {
    let real = fs::canonicalize(path).map_err(|e| format!("{path}: {e}"))?;
    roots.iter().filter_map(|r| fs::canonicalize(r).ok()).any(|r| real.starts_with(&r)).then_some(real)
        .ok_or_else(|| format!("{path} is not in this project's folders"))
}

/// A folder's entries: [{name, path, dir, ignored}], folders first, then by name. `ignored` is what git ignores
/// there (node_modules, vendor), shown grey. Not .git and not .DS_Store.
pub fn list(roots: &[String], path: &str, path_env: &str) -> Result<Value, String> {
    let dir = inside(roots, path)?;
    let mut entries: Vec<(String, bool)> = fs::read_dir(&dir).map_err(|e| format!("{path}: {e}"))?.flatten()
        .map(|e| (e.file_name().to_string_lossy().into_owned(), e.path().is_dir()))
        .filter(|(n, _)| n != ".git" && n != ".DS_Store").take(MAX_ENTRIES).collect();
    entries.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.to_lowercase().cmp(&b.0.to_lowercase())));
    let names: Vec<&str> = entries.iter().map(|(n, _)| n.as_str()).collect();
    // outside a repo git exits 128 and nothing is ignored
    let ignored: Vec<String> = if names.is_empty() { vec![] } else {
        Command::new("git").arg("-C").arg(&dir).args(["check-ignore", "--"]).args(&names).env("PATH", path_env).output()
            .map(|o| String::from_utf8_lossy(&o.stdout).lines().map(str::to_string).collect()).unwrap_or_default()
    };
    Ok(Value::Array(entries.iter().map(|(n, d)| json!({"name": n, "path": dir.join(n).to_string_lossy(), "dir": d, "ignored": ignored.contains(n)})).collect()))
}

/// A text file to show: refused over 2 MB and for a binary one (a NUL byte in its start), the webview then opens it in
/// its own app.
pub fn read(roots: &[String], path: &str) -> Result<String, String> {
    let file = inside(roots, path)?;
    let size = fs::metadata(&file).map_err(|e| e.to_string())?.len();
    if size > MAX_TEXT { return Err("binary".into()); }
    let bytes = fs::read(&file).map_err(|e| e.to_string())?;
    if bytes.iter().take(8000).any(|b| *b == 0) { return Err("binary".into()); }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_reads_and_stays_inside_the_roots() {
        let path = std::env::var("PATH").unwrap();
        let tmp = fs::canonicalize(std::env::temp_dir()).unwrap().join(format!("relay-explorer-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let proj = tmp.join("proj");
        fs::create_dir_all(proj.join("src")).unwrap();
        fs::create_dir_all(proj.join("node_modules")).unwrap();
        fs::write(proj.join("README.md"), "hi\n").unwrap();
        fs::write(proj.join("b.txt"), "b").unwrap();
        fs::write(proj.join(".gitignore"), "node_modules\n").unwrap();
        fs::write(proj.join("logo.png"), [0x89, b'P', b'N', b'G', 0, 0, 1]).unwrap();
        fs::write(tmp.join("secret.txt"), "no").unwrap();
        std::os::unix::fs::symlink(tmp.join("secret.txt"), proj.join("link.txt")).unwrap();
        assert!(Command::new("git").arg("-C").arg(&proj).args(["init", "-q"]).status().unwrap().success());
        let roots = vec![proj.to_string_lossy().into_owned()];

        let v = list(&roots, &proj.to_string_lossy(), &path).unwrap();
        let names: Vec<&str> = v.as_array().unwrap().iter().map(|e| e["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["node_modules", "src", ".gitignore", "b.txt", "link.txt", "logo.png", "README.md"]);
        let ignored: Vec<&str> = v.as_array().unwrap().iter().filter(|e| e["ignored"] == true).map(|e| e["name"].as_str().unwrap()).collect();
        assert_eq!(ignored, ["node_modules"]);

        assert_eq!(read(&roots, &proj.join("README.md").to_string_lossy()).unwrap(), "hi\n");
        assert_eq!(read(&roots, &proj.join("logo.png").to_string_lossy()).unwrap_err(), "binary");
        // outside the roots, also through a symlink or ..
        assert!(read(&roots, &tmp.join("secret.txt").to_string_lossy()).is_err());
        assert!(read(&roots, &proj.join("link.txt").to_string_lossy()).is_err());
        assert!(list(&roots, &proj.join("..").to_string_lossy(), &path).is_err());
        assert!(list(&roots, "/etc", &path).is_err());
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn roots_are_the_code_folders_then_the_vault_folder() {
        let tmp = fs::canonicalize(std::env::temp_dir()).unwrap().join(format!("relay-explorer-roots-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let vault = tmp.join("vault");
        fs::create_dir_all(vault.join("Contexts/Work/Projects/Beacon")).unwrap();
        fs::write(vault.join("Contexts/Work/Projects/Beacon/Beacon.md"), "# Beacon").unwrap();
        fs::create_dir_all(tmp.join("code/beacon")).unwrap();
        let idx = json!({
            tmp.join("code/beacon").to_string_lossy(): "Contexts/Work/Projects/Beacon/Beacon.md",
            tmp.join("code/gone").to_string_lossy(): "Contexts/Work/Projects/Beacon/Beacon.md",
            tmp.join("code").to_string_lossy(): "Contexts/Work/Projects/Other/Other.md",
        }).to_string();
        let v = roots(&vault.to_string_lossy(), Some(idx), "Beacon");
        let got: Vec<(String, bool)> = v["roots"].as_array().unwrap().iter().map(|r| (r["label"].as_str().unwrap().to_string(), r["vault"].as_bool().unwrap())).collect();
        assert_eq!(got, [("beacon".to_string(), false), ("Beacon".to_string(), true)]);
        // no project: the vault itself
        let v = roots(&vault.to_string_lossy(), None, "");
        assert_eq!(v["roots"][0]["path"], json!(vault.to_string_lossy()));
        fs::remove_dir_all(&tmp).ok();
    }
}
