#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os, sys, glob, argparse
from git import Repo, GitCommandError, InvalidGitRepositoryError, NoSuchPathError
import glob as glob_mod
import fnmatch

# ====== ARGUMENTOS ======
ap = argparse.ArgumentParser(description="Push selectivo al repo (modo snapshot)")
ap.add_argument("--include", action="append", default=[], help="Ruta/archivo a incluir (repetible). Acepta globs.")
ap.add_argument("--exclude", action="append", default=[], help="Patrón a excluir (glob). Repetible.")
args = ap.parse_args()

# ====== CONFIG ======
TOKEN = os.environ.get("GITHUB_TOKEN")
if not TOKEN:
    raise SystemExit("No se encontró la variable de entorno GITHUB_TOKEN.")

USERNAME     = "pronosticosnumericos"
REPO_NAME    = "pronosticos_numericos"
REMOTE_PLAIN = f"https://github.com/{USERNAME}/{REPO_NAME}.git"
REMOTE_AUTH  = f"https://{USERNAME}:{TOKEN}@github.com/{USERNAME}/{REPO_NAME}.git"

REPO_PATH = "/home/sig07/pronosticos_numericos"
BRANCH    = "main"

DEFAULT_IGNORE = [
    "prcp_matrix.json",
    "prcp/prcp_matrix.json",
    "*.nc",
    "*.grib2",
    "*.grb",
    "*.grb2",
    "*.tmp",
]

def ensure_repo(path: str) -> Repo:
    try:
        return Repo(path)
    except (InvalidGitRepositoryError, NoSuchPathError):
        repo = Repo.init(path)
        with repo.config_writer() as cw:
            cw.set_value("user", "name",  "Julio (pronosticos_numericos)")
            cw.set_value("user", "email", "tu_correo@ejemplo.com")
        return repo

def append_unique_lines(file_path: str, lines):
    existing = set()
    if os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8") as f:
            existing = {ln.rstrip("\n") for ln in f}
    to_add = [ln for ln in lines if ln not in existing]
    if to_add:
        with open(file_path, ("a" if existing else "w"), encoding="utf-8") as f:
            for ln in to_add:
                f.write(f"{ln}\n")
        return True
    return False

def resolve_includes(repo_root: str, includes, excludes):
    """
    Expande globs de --include dentro de REPO_PATH y filtra --exclude (globs).
    Devuelve rutas relativas respecto al repo (lo que espera git add).
    """
    if not includes:
        return []

    picked_abs = set()
    for inc in includes:
        pattern = inc if os.path.isabs(inc) else os.path.join(repo_root, inc)
        matches = glob_mod.glob(pattern, recursive=True)
        for m in matches:
            if os.path.isdir(m):
                for r, _, files in os.walk(m):
                    for fn in files:
                        picked_abs.add(os.path.join(r, fn))
            else:
                picked_abs.add(m)

    def excluded(path_abs: str) -> bool:
        for ex in excludes:
            ex_pat = ex if os.path.isabs(ex) else os.path.join(repo_root, ex)
            if fnmatch.fnmatch(path_abs, ex_pat):
                return True
        return False

    kept_abs = [p for p in picked_abs if os.path.exists(p) and not excluded(p)]
    rels = []
    for p in kept_abs:
        try:
            rels.append(os.path.relpath(p, repo_root))
        except ValueError:
            pass
    return sorted(set(rels))

repo = ensure_repo(REPO_PATH)
git  = repo.git

# Asegurar rama
if repo.head.is_detached:
    if BRANCH in repo.heads:
        git.branch("-f", BRANCH, "HEAD")
        git.checkout(BRANCH)
    else:
        git.checkout("-b", BRANCH)
else:
    if BRANCH in repo.heads:
        git.checkout(BRANCH)
    else:
        git.checkout("-b", BRANCH)

# .gitignore por defecto
gi_path = os.path.join(REPO_PATH, ".gitignore")
ignore_lines = sorted(set(DEFAULT_IGNORE))
if append_unique_lines(gi_path, ignore_lines):
    repo.index.add([gi_path])

# 1) Stage selectivo según --include/--exclude
stage_list = resolve_includes(REPO_PATH, args.include, args.exclude)

# 2) Actualizar cambios/borrados de archivos ya tracked
git.add("-u")

# 3) Añadir explícitamente los nuevos archivos seleccionados
if stage_list:
    repo.index.add(stage_list)

# ¿Hay algo staged para commit?
# Intentamos detectar si hay commits previos
has_commits = True
try:
    _ = repo.head.commit
except Exception:
    has_commits = False

# Si no hay nada que haya cambiado, salir
if not repo.is_dirty(index=True, working_tree=True, untracked_files=False) and has_commits:
    print("No hay cambios que subir.")
    sys.exit(0)

if has_commits:
    # Reescribe SIEMPRE el último commit → repo tipo snapshot
    try:
        git.commit("--amend", "--no-edit")
        print("Commit actualizado con --amend.")
    except GitCommandError as e:
        print(f"Nada que commitear: {e}")
        sys.exit(0)
else:
    repo.index.commit("Snapshot inicial selectivo")
    print("Commit inicial creado.")

# Remote origin sin token
try:
    repo.create_remote("origin", REMOTE_PLAIN)
except GitCommandError:
    git.remote("set-url", "origin", REMOTE_PLAIN)

# Push forzado usando URL con token (no se guarda en la config)
try:
    git.push("--force", "-u", REMOTE_AUTH, f"{BRANCH}:{BRANCH}")
    print("Push forzado OK.")
except GitCommandError as e:
    print(f"Error en push: {e}")
    sys.exit(1)

print("Push realizado correctamente (selectivo, modo snapshot).")

