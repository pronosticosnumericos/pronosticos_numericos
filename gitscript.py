#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
from git import Repo, GitCommandError, InvalidGitRepositoryError, NoSuchPathError

TOKEN = os.environ.get("GITHUB_TOKEN")
if not TOKEN:
    raise SystemExit("No se encontró la variable de entorno GITHUB_TOKEN.")

USERNAME   = "pronosticosnumericos"
REMOTE_URL = f"https://{USERNAME}:{TOKEN}@github.com/{USERNAME}/pronosticos_numericos.git"
REPO_PATH  = "/home/sig07/pronosticos_numericos"
BRANCH     = "main"
# Cambia a True si QUIERES sobreescribir el remoto cueste lo que cueste
OVERWRITE_REMOTE = False

def ensure_repo(path: str) -> Repo:
    try:
        return Repo(path)
    except (InvalidGitRepositoryError, NoSuchPathError):
        repo = Repo.init(path)
        with repo.config_writer() as cw:
            cw.set_value("user", "name",  "Julio (website_nuevo)")
            cw.set_value("user", "email", "you@example.com")
        return repo

def ensure_lines_in_gitignore(repo_path, lines):
    gi_path = os.path.join(repo_path, ".gitignore")
    existing = set()
    if os.path.exists(gi_path):
        with open(gi_path, "r", encoding="utf-8") as f:
            existing = {ln.rstrip("\n") for ln in f}
    with open(gi_path, "a", encoding="utf-8") as f:
        for line in lines:
            if line not in existing:
                f.write(f"{line}\n")

repo = ensure_repo(REPO_PATH)
git  = repo.git

# Asegura rama
if BRANCH in repo.heads:
    git.checkout(BRANCH)
else:
    git.checkout("-b", BRANCH)

# .gitignore sin duplicar
ensure_lines_in_gitignore(REPO_PATH, ["prcp_matrix.json", "prcp/prcp_matrix.json"])

# Stage + commit
repo.git.add(A=True)
try:
    # Si hay cambios, comitea
    if repo.is_dirty(untracked_files=True):
        repo.index.commit("Snapshot automático")
except Exception as e:
    raise SystemExit(f"Error al preparar commit: {e}")

# Remoto origin
try:
    repo.create_remote("origin", REMOTE_URL)
except GitCommandError:
    git.remote("set-url", "origin", REMOTE_URL)

origin = repo.remotes.origin

# **FETCH** antes de empujar para evitar "stale info"
origin.fetch(prune=True)

# Asegura upstream (por si es la primera vez)
try:
    repo.git.rev_parse("--verify", "@{u}")
except GitCommandError:
    # No hay upstream; lo configuramos al empujar
    pass

# Empuje
try:
    if OVERWRITE_REMOTE:
        # Peligroso: sobreescribe el historial remoto
        git.push("--force", "-u", "origin", BRANCH)
    else:
        # Seguro: con lease, pero ya hicimos fetch → no debería marcar "stale info"
        git.push("--force-with-lease", "-u", "origin", BRANCH)
    print("Push realizado correctamente.")
except GitCommandError as e:
    # Si vuelve a fallar por lease, ofrece fallback seguro
    print(f"[WARN] Push con '--force-with-lease' falló: {e}")
    print("Sugerencia: vuelve a intentar tras un 'git fetch' o activa OVERWRITE_REMOTE=True.")
    raise

